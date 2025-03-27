export interface Command {
  category: "command"; // To identify the type
  id: string; // Use string for potential consistency with objectIDs
  name: string;
  trigger: string;
  extension: string;
  type: string; // The type specific to the command itself
}
