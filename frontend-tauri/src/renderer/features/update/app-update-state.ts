export type AppUpdateToolbarViewState =
  | { state: 'hidden' }
  | {
      state: 'available';
      version: string;
      onActivate: () => void | Promise<void>;
    }
  | {
      state: 'downloading' | 'waitingForOperations';
      version: string;
      progressPercent: number;
      onCancel: () => void | Promise<void>;
    }
  | {
      state: 'readyToInstall';
      version: string;
      onCancel: () => void | Promise<void>;
    }
  | {
      state: 'launchingUpdater';
      version: string;
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
