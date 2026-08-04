export interface AppLanguageState {
  language: string | null;
  ready: boolean;
  rollbackLanguage: string | null;
}

export type AppLanguageAction =
  | {
      type: 'native-loaded';
      language: string;
    }
  | {
      type: 'save-requested';
      language: string;
    }
  | {
      type: 'save-failed';
    }
  | {
      type: 'language-confirmed';
      language: string;
    }
  | {
      type: 'native-load-failed';
    };

export const initialAppLanguageState: AppLanguageState = {
  language: null,
  ready: false,
  rollbackLanguage: null
};

export const appLanguageReducer = (
  state: AppLanguageState,
  action: AppLanguageAction
): AppLanguageState => {
  switch (action.type) {
    case 'native-loaded':
      return {
        language: action.language,
        ready: true,
        rollbackLanguage: null
      };
    case 'save-requested':
      return {
        language: action.language,
        ready: true,
        rollbackLanguage: state.language
      };
    case 'save-failed':
      return {
        language: state.rollbackLanguage ?? state.language,
        ready: true,
        rollbackLanguage: null
      };
    case 'language-confirmed':
      return {
        language: action.language,
        ready: true,
        rollbackLanguage: null
      };
    case 'native-load-failed':
      return {
        language: state.language ?? 'en-us',
        ready: true,
        rollbackLanguage: null
      };
  }
};
