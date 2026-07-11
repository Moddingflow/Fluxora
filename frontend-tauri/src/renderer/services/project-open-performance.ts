export interface ProjectOpenPerformanceSample {
  operationId: string;
  projectId: string;
  openConfigMs: number;
  workspaceDataMs: number;
  renderCommitMs: number;
  totalMs: number;
}

export interface ProjectOpenBackgroundPerformanceSample {
  operationId: string;
  projectId: string;
  backgroundAfterInteractiveMs: number;
  totalToBackgroundMs: number;
}

export interface ProjectOpenTiming {
  markProjectConfigLoaded: () => void;
  markWorkspaceDataLoaded: () => void;
  complete: (projectId: string) => ProjectOpenPerformanceSample;
  completeBackground: (projectId: string) => ProjectOpenBackgroundPerformanceSample;
}

export const createProjectOpenTiming = (
  operationId: string,
  now: () => number = () => performance.now()
): ProjectOpenTiming => {
  const startedAtMs = now();
  let projectConfigLoadedAtMs: number | null = null;
  let workspaceDataLoadedAtMs: number | null = null;
  let interactiveAtMs: number | null = null;

  return {
    markProjectConfigLoaded: () => {
      projectConfigLoadedAtMs ??= now();
    },
    markWorkspaceDataLoaded: () => {
      workspaceDataLoadedAtMs ??= now();
    },
    complete: (projectId) => {
      if (projectConfigLoadedAtMs === null || workspaceDataLoadedAtMs === null) {
        throw new Error('Project open timing completed before all required phases were marked.');
      }

      const renderedAtMs = now();
      interactiveAtMs ??= renderedAtMs;
      return {
        operationId,
        projectId,
        openConfigMs: projectConfigLoadedAtMs - startedAtMs,
        workspaceDataMs: workspaceDataLoadedAtMs - projectConfigLoadedAtMs,
        renderCommitMs: renderedAtMs - workspaceDataLoadedAtMs,
        totalMs: renderedAtMs - startedAtMs
      };
    },
    completeBackground: (projectId) => {
      if (interactiveAtMs === null) {
        throw new Error('Background project loading completed before the interface was interactive.');
      }
      const backgroundAtMs = now();
      return {
        operationId,
        projectId,
        backgroundAfterInteractiveMs: backgroundAtMs - interactiveAtMs,
        totalToBackgroundMs: backgroundAtMs - startedAtMs
      };
    }
  };
};

export const formatProjectOpenPerformanceMessage = (
  sample: ProjectOpenPerformanceSample
): string =>
  [
    'project_open_completed',
    `projectId=${sample.projectId}`,
    `openConfigMs=${sample.openConfigMs.toFixed(2)}`,
    `workspaceDataMs=${sample.workspaceDataMs.toFixed(2)}`,
    `renderCommitMs=${sample.renderCommitMs.toFixed(2)}`,
    `totalMs=${sample.totalMs.toFixed(2)}`
  ].join(' ');

export const formatProjectOpenBackgroundPerformanceMessage = (
  sample: ProjectOpenBackgroundPerformanceSample
): string =>
  [
    'project_open_background_completed',
    `projectId=${sample.projectId}`,
    `backgroundAfterInteractiveMs=${sample.backgroundAfterInteractiveMs.toFixed(2)}`,
    `totalToBackgroundMs=${sample.totalToBackgroundMs.toFixed(2)}`
  ].join(' ');
