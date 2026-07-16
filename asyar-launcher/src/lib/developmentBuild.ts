export interface DevelopmentBuildIndicator {
  text: string;
  title: string;
}

export function getDevelopmentBuildIndicator(
  isDevelopment: boolean,
): DevelopmentBuildIndicator | null {
  return isDevelopment ? { text: 'DEV', title: 'Development build' } : null;
}

export const developmentBuildIndicator = getDevelopmentBuildIndicator(import.meta.env.DEV);
