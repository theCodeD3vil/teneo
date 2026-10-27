// Finds API keys and other secrets in copied text. It runs on this Mac only:
// nothing is sent anywhere, and keys are never checked with their provider.
// Rules follow gitleaks (MIT, github.com/gitleaks/gitleaks) and stick to keys
// with a known shape, so ordinary text is rarely mistaken for one.
import type { SecretSpan } from "../shared/types/clipboard";

interface SecretRule {
  label: string;
  /** the pattern only runs on text containing one of these, a cheap first check */
  keywords: string[];
  /** the `secret` group is the part to hide; a known prefix stays visible */
  pattern: RegExp;
}

const secretRules: SecretRule[] = [
  {
    label: "Private key",
    keywords: ["PRIVATE KEY-----"],
    pattern:
      /-----BEGIN[A-Z ]*PRIVATE KEY-----\s*(?<secret>[\s\S]+?)\s*-----END[A-Z ]*PRIVATE KEY-----/dg,
  },
  {
    label: "GitHub token",
    keywords: ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"],
    pattern: /\bgh[pousr]_(?<secret>[A-Za-z0-9]{36})\b/dg,
  },
  {
    label: "GitHub token",
    keywords: ["github_pat_"],
    pattern: /\bgithub_pat_(?<secret>\w{82})\b/dg,
  },
  {
    label: "GitLab token",
    keywords: ["glpat-"],
    pattern: /\bglpat-(?<secret>[\w-]{20,})/dg,
  },
  {
    label: "AWS access key",
    keywords: ["AKIA", "ASIA"],
    pattern: /\b(?:AKIA|ASIA)(?<secret>[A-Z2-7]{16})\b/dg,
  },
  {
    label: "AWS secret key",
    // ~/.aws/credentials, env vars and `aws iam create-access-key` output
    keywords: [
      "aws_secret_access_key",
      "AWS_SECRET_ACCESS_KEY",
      "SecretAccessKey",
    ],
    pattern:
      /(?:aws_secret_access_key|SecretAccessKey)["']?\s*[:=]\s*["']?(?<secret>[A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])/dgi,
  },
  {
    label: "Google API key",
    keywords: ["AIza"],
    pattern: /\bAIza(?<secret>[\w-]{35})(?![\w-])/dg,
  },
  {
    label: "Slack token",
    keywords: ["xox"],
    pattern: /\bxox[abposr]-(?<secret>[A-Za-z0-9-]{10,})/dg,
  },
  {
    label: "Slack webhook",
    keywords: ["hooks.slack.com/"],
    pattern:
      /hooks\.slack\.com\/(?:services|workflows|triggers)\/(?<secret>[\w+/-]{20,})/dg,
  },
  {
    label: "Stripe key",
    keywords: ["sk_live_", "sk_test_", "rk_live_", "rk_test_"],
    pattern: /\b[rs]k_(?:live|test)_(?<secret>[A-Za-z0-9]{20,})/dg,
  },
  {
    label: "Anthropic API key",
    keywords: ["sk-ant-"],
    pattern: /\bsk-ant-(?:[a-z]+\d+-)?(?<secret>[\w-]{20,})/dg,
  },
  {
    label: "OpenAI API key",
    keywords: ["sk-proj-", "sk-svcacct-", "sk-admin-"],
    pattern: /\bsk-(?:proj|svcacct|admin)-(?<secret>[\w-]{20,})/dg,
  },
  {
    label: "OpenAI API key",
    // older keys carry "OpenAI" in base64 in the middle
    keywords: ["T3BlbkFJ"],
    pattern: /\bsk-(?<secret>[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})\b/dg,
  },
  {
    label: "Hyper API key",
    keywords: ["sk-hyper-"],
    pattern: /\bsk-hyper-(?<secret>[\w-]{20,})/dg,
  },
  {
    label: "npm token",
    keywords: ["npm_"],
    pattern: /\bnpm_(?<secret>[A-Za-z0-9]{36})\b/dg,
  },
  {
    label: "JWT",
    keywords: ["eyJ"],
    pattern: /\beyJ(?<secret>[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{10,})/dg,
  },
  {
    label: "Password in URL",
    // user:password@ in a URL, such as a database connection string. The scheme
    // is capped: unbounded, a long run of letters and dots takes quadratic time
    keywords: ["://"],
    pattern: /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/@]+:(?<secret>[^\s/@]+)@/dg,
  },
];

// Longer text is only scanned this far, so a huge paste can't stall the backend
const maximumScannedLength = 100_000;

/** Where the secrets in `text` are, in order and never overlapping. */
export function findSecrets(text: string): SecretSpan[] {
  const scannedText = text.slice(0, maximumScannedLength);
  const secrets: SecretSpan[] = [];
  for (const { label, keywords, pattern } of secretRules) {
    if (!keywords.some((keyword) => scannedText.includes(keyword))) continue;
    for (const match of scannedText.matchAll(pattern)) {
      const [start, end] = match.indices!.groups!.secret;
      secrets.push({ start, end, label });
    }
  }

  // rules can overlap, such as a JWT used as a URL password: the first one wins
  secrets.sort((first, second) => first.start - second.start);
  const separateSecrets: SecretSpan[] = [];
  for (const secret of secrets) {
    if (secret.start >= (separateSecrets.at(-1)?.end ?? 0)) {
      separateSecrets.push(secret);
    }
  }
  return separateSecrets;
}
