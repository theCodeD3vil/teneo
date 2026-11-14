// Where Teneo listens for other devices, in order of preference: the next one
// is tried when a port is taken. Kept apart so a script can read it without
// pulling in the transport.
export const syncPorts = [47823, 47824, 47825, 47826, 47827];
