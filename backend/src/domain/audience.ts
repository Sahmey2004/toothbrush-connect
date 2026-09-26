export type Audience =
  | { type: "everyone" }
  | { type: "list"; listId: string }
  | { type: "custom"; friendIds: string[] };
