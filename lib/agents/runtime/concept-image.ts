export interface ConceptImage {
  title: string;
  dataUrl: string;
  prompt?: string;
  provider?: string;
  model?: string;
  aspectRatio?: string;
  quality?: string;
}

export interface ConceptPrompt {
  title: string;
  prompt: string;
}
