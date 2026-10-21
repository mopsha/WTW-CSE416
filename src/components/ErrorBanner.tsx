import { ErrorState } from './ErrorState';

interface Props {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/** Inline error strip. Kept for existing screens; new code can use `<ErrorState />` directly. */
export function ErrorBanner(props: Props) {
  return <ErrorState {...props} variant="banner" />;
}
