import { Redirect } from 'expo-router';

// Catches any unmatched routes (e.g. stale navigation state) and returns to root.
export default function NotFound() {
  return <Redirect href="/" />;
}
