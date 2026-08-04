export type AppUpdateToolbarViewState =
  | { state: 'hidden' }
  | {
      state: 'available';
      version: string;
      onActivate: () => void | Promise<void>;
    }
  | {
      state: 'error';
      version: string;
      errorMessage: string;
      retryable: true;
      onActivate: () => void | Promise<void>;
    }
  | {
      state: 'error';
      version: string;
      errorMessage: string;
      retryable: false;
    };
