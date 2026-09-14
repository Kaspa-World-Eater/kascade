/** KAS from sompi, fixed to 8 places — the one number format the CLI and its helpers share. */
export const kas = (sompi: number | bigint): string => (Number(sompi) / 1e8).toFixed(8);
