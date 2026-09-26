export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="error-note" role="alert">{error}</p>;
}
