export const omit = <T extends readonly string[], K extends T[number]>(
  list: T,
  ...drop: K[]
) => list.filter((v): v is Exclude<T[number], K> => !drop.includes(v as K));
