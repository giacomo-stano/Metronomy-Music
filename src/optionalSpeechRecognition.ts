declare const require: (name: string) => any;

type Subscription = {
  remove: () => void;
};

export type OptionalSpeechRecognitionModule = {
  abort: () => void;
  stop: () => void;
  start: (options: Record<string, unknown>) => void;
  isRecognitionAvailable: () => boolean;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  supportsOnDeviceRecognition: () => boolean;
  addListener: (
    eventName: string,
    listener: (event: any) => void
  ) => Subscription;
};

let module: OptionalSpeechRecognitionModule | null = null;

try {
  const speech = require('expo-speech-recognition');
  module = speech?.ExpoSpeechRecognitionModule ?? null;
} catch {
  // Expo Go does not include the native speech-recognition module.
  module = null;
}

export const optionalSpeechRecognition = module;
