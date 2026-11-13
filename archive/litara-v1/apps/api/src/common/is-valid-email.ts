/** Returns true if the string looks like a valid email (has an @ and a dot after it). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
