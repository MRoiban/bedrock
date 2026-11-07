export const webBuildDirectory = ".bedrock-web";
export interface WebBuild { version: 1; bundled: boolean; files: string[]; maps: Record<string, string> }
