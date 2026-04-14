// Holds the version string to display in the What's New panel.
// Set to a version string to show the panel; null to hide it.
class WhatsNewStore {
  version = $state<string | null>(null)
}

export const whatsNewStore = new WhatsNewStore()
