import type {
  InstallerLanguage,
  NativeFailure,
  UpdateProgress,
  UpdateRequestSummary,
  UpdateResult
} from '../contracts';

export interface UpdaterFlowState {
  language: InstallerLanguage;
  state: 'loading' | 'running' | 'result';
  summary: UpdateRequestSummary | null;
  progress: UpdateProgress | null;
  result: UpdateResult | null;
  failure: NativeFailure | null;
  noticeKey: string | null;
}

export const initialUpdaterFlowState: UpdaterFlowState = {
  language: 'en',
  state: 'loading',
  summary: null,
  progress: null,
  result: null,
  failure: null,
  noticeKey: null
};

export type UpdaterFlowAction =
  | { type: 'language'; language: InstallerLanguage }
  | { type: 'summary'; summary: UpdateRequestSummary }
  | { type: 'progress'; progress: UpdateProgress }
  | { type: 'result'; result: UpdateResult }
  | { type: 'failure'; failure: NativeFailure }
  | { type: 'notice'; key: string | null };

export function updaterFlowReducer(
  state: UpdaterFlowState,
  action: UpdaterFlowAction
): UpdaterFlowState {
  switch (action.type) {
    case 'language':
      return { ...state, language: action.language };
    case 'summary':
      return {
        ...state,
        state: 'running',
        language: action.summary.language,
        summary: action.summary,
        failure: null
      };
    case 'progress':
      if (state.summary && state.summary.operationId !== action.progress.operationId) {
        return state;
      }
      return {
        ...state,
        state: 'running',
        progress: state.progress
          ? {
              ...action.progress,
              percent: Math.max(state.progress.percent, action.progress.percent)
            }
          : action.progress
      };
    case 'result':
      return { ...state, state: 'result', result: action.result, failure: null };
    case 'failure':
      return { ...state, state: 'result', failure: action.failure, result: null };
    case 'notice':
      return { ...state, noticeKey: action.key };
  }
}
