// Analytics event names. Properties must never carry check-in text, names or phone numbers.
export type AnalyticsEvent =
  | "session_started" | "session_completed" | "session_ended_early"
  | "check_in_posted" | "check_in_undone" | "audience_changed" | "check_in_delivered"
  | "overlap_started" | "reaction_sent" | "invite_sent" | "invite_accepted";
