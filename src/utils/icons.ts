import "material-symbols";

export const Icons = {
  CLIPBOARD: "content_paste",
  CALCULATOR: "calculate",
  APP: "apps",
  SETTINGS: "settings",
  BROWSER: "public",
  CALENDAR: "calendar_month",
  MESSAGES: "chat",
  MAIL: "mail",
  MAPS: "map",
  NOTES: "note",
  PHOTOS: "photo_library",
  TERMINAL: "terminal",
  TEXT_EDITOR: "edit_note",
  PASSWORD: "password",
  DEFAULT: "radio_button_unchecked",
} as const;

export type IconName = (typeof Icons)[keyof typeof Icons];
