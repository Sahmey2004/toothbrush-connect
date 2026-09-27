import { supabase } from "./supabase";

/** The app's single sign-in: Google through Supabase OAuth.
 *  On success the browser redirects to Google (nothing is returned here); on failure
 *  returns a human-readable message. `returnTo` is the app path Google sends people back to. */
export async function signInWithGoogle(returnTo = "/login"): Promise<string | null> {
  const redirectTo = `${location.origin}${returnTo}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (!error) return null;
  return error.message.includes("provider is not enabled")
    ? "Google sign-in isn't set up for this project yet."
    : error.message;
}
