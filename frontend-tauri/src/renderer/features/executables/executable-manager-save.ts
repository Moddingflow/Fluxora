import type {
  FluxoraExecutable,
  FluxoraExecutableInspection,
  OperationRequest
} from '../../../shared/fluxora-api';

export interface ExecutableDraftSaveRequest {
  configPath: string;
  executables: FluxoraExecutable[];
  operationId: string;
}

export interface ExecutableDraftSaveDependencies {
  inspect: (
    configPath: string,
    executablePath: string,
    request: OperationRequest
  ) => Promise<FluxoraExecutableInspection>;
  save: (
    configPath: string,
    executables: FluxoraExecutable[],
    request: OperationRequest
  ) => Promise<FluxoraExecutable[]>;
  acceptCanonical: (executables: FluxoraExecutable[]) => void;
  close: () => Promise<void>;
}

export class ExecutableDraftInspectionError extends Error {
  readonly executableId: string;

  constructor(executableId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ExecutableDraftInspectionError';
    this.executableId = executableId;
  }
}

export async function commitExecutableDraft(
  request: ExecutableDraftSaveRequest,
  dependencies: ExecutableDraftSaveDependencies
): Promise<FluxoraExecutable[]> {
  for (const executable of request.executables) {
    try {
      await dependencies.inspect(request.configPath, executable.executablePath, {
        operationId: request.operationId
      });
    } catch (error) {
      throw new ExecutableDraftInspectionError(executable.id, error);
    }
  }

  const canonical = await dependencies.save(
    request.configPath,
    request.executables,
    { operationId: request.operationId }
  );
  dependencies.acceptCanonical(canonical);
  await dependencies.close();
  return canonical;
}
