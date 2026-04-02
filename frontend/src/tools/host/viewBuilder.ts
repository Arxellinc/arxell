import type { AppEvent, FilesListDirectoryEntry, FlowRerunValidationResult } from "../../contracts";
import { renderFilesToolActions, renderFilesToolBody } from "../files";
import type { FilesColumnWidths } from "../files/index";
import { renderFlowToolActions, renderFlowToolBody } from "../flow";
import type { FlowRunView } from "../flow/state";
import { renderMemoryToolActions, renderMemoryToolBody } from "../memory";
import { renderSkillsToolActions, renderSkillsToolBody } from "../skills";
import { renderTasksToolActions, renderTasksToolBody } from "../tasks";
import type { TaskFolder, TaskSortDirection, TaskSortKey, TaskRecord } from "../tasks/state";
import { renderWebToolActions, renderWebToolBody } from "../webSearch";
import type { WebSearchHistoryItem, WebTabState } from "../webSearch/state";

export interface ToolViewHtml {
  actionsHtml: string;
  bodyHtml: string;
}

export interface WorkspaceToolViewInput {
  activeWebTab: WebTabState | null;
  webTabs: WebTabState[];
  activeWebTabId: string;
  webHistoryOpen: boolean;
  webHistoryClearConfirmOpen: boolean;
  webHistory: WebSearchHistoryItem[];
  webSetupModalOpen: boolean;
  webSetupAccount: string;
  webSetupApiKey: string;
  webSetupMessage: string | null;
  webSetupBusy: boolean;
  filesRootPath: string | null;
  filesSelectedPath: string | null;
  filesSelectedEntryPath: string | null;
  filesOpenTabs: string[];
  filesActiveTabPath: string | null;
  filesContentByPath: Record<string, string>;
  filesDirtyByPath: Record<string, boolean>;
  filesLoadingFileByPath: Record<string, boolean>;
  filesSavingFileByPath: Record<string, boolean>;
  filesReadOnlyByPath: Record<string, boolean>;
  filesSizeByPath: Record<string, number>;
  filesExpandedByPath: Record<string, boolean>;
  filesEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  filesLoadingByPath: Record<string, boolean>;
  filesColumnWidths: Partial<FilesColumnWidths>;
  filesSidebarWidth: number;
  filesSidebarCollapsed: boolean;
  filesFindOpen: boolean;
  filesFindQuery: string;
  filesReplaceQuery: string;
  filesFindCaseSensitive: boolean;
  filesLineWrap: boolean;
  filesError: string | null;
  tasksById: Record<string, TaskRecord>;
  tasksSelectedId: string | null;
  tasksFolder: TaskFolder;
  tasksSortKey: TaskSortKey;
  tasksSortDirection: TaskSortDirection;
  tasksDetailsCollapsed: boolean;
  tasksJsonDraft: string;
  flowRuns: FlowRunView[];
  flowActiveRunId: string | null;
  flowMode: "plan" | "build";
  flowMaxIterations: number;
  flowDryRun: boolean;
  flowAutoPush: boolean;
  flowPromptPlanPath: string;
  flowPromptBuildPath: string;
  flowPlanPath: string;
  flowSpecsGlob: string;
  flowImplementCommand: string;
  flowBackpressureCommands: string;
  flowEventFilter: string;
  flowValidationResults: FlowRerunValidationResult[];
  flowBusy: boolean;
  flowMessage: string | null;
  filteredFlowEvents: AppEvent[];
}

export function buildWorkspaceToolViews(input: WorkspaceToolViewInput): Record<string, ToolViewHtml> {
  const activeFlowRunId = input.flowActiveRunId ?? input.flowRuns[0]?.runId ?? null;

  return {
    webSearch: {
      actionsHtml: renderWebToolActions(
        input.webTabs.map((tab) => ({
          id: tab.id,
          label: tab.title,
          active: tab.id === input.activeWebTabId
        })),
        input.activeWebTab?.viewMode ?? "markdown",
        input.webHistoryOpen,
        input.activeWebTab?.busy ?? false
      ),
      bodyHtml: renderWebToolBody({
        tabId: input.activeWebTab?.id ?? "",
        title: input.activeWebTab?.title ?? "Search",
        query: input.activeWebTab?.query ?? "",
        mode: input.activeWebTab?.mode ?? "search",
        viewMode: input.activeWebTab?.viewMode ?? "markdown",
        num: input.activeWebTab?.num ?? 10,
        busy: input.activeWebTab?.busy ?? false,
        message: input.activeWebTab?.message ?? null,
        result: input.activeWebTab?.result ?? null,
        historyOpen: input.webHistoryOpen,
        historyClearConfirmOpen: input.webHistoryClearConfirmOpen,
        historyItems: input.webHistory,
        setupModalOpen: input.webSetupModalOpen,
        setupAccount: input.webSetupAccount,
        setupApiKey: input.webSetupApiKey,
        setupMessage: input.webSetupMessage,
        setupBusy: input.webSetupBusy
      })
    },
    files: {
      actionsHtml: renderFilesToolActions({
        rootPath: input.filesRootPath,
        selectedPath: input.filesSelectedPath,
        selectedEntryPath: input.filesSelectedEntryPath,
        openTabs: input.filesOpenTabs,
        activeTabPath: input.filesActiveTabPath,
        contentByPath: input.filesContentByPath,
        dirtyByPath: input.filesDirtyByPath,
        loadingFileByPath: input.filesLoadingFileByPath,
        savingFileByPath: input.filesSavingFileByPath,
        readOnlyByPath: input.filesReadOnlyByPath,
        sizeByPath: input.filesSizeByPath,
        expandedByPath: input.filesExpandedByPath,
        entriesByPath: input.filesEntriesByPath,
        loadingByPath: input.filesLoadingByPath,
        columnWidths: input.filesColumnWidths,
        sidebarWidth: input.filesSidebarWidth,
        sidebarCollapsed: input.filesSidebarCollapsed,
        findOpen: input.filesFindOpen,
        findQuery: input.filesFindQuery,
        replaceQuery: input.filesReplaceQuery,
        findCaseSensitive: input.filesFindCaseSensitive,
        lineWrap: input.filesLineWrap,
        error: input.filesError
      }),
      bodyHtml: renderFilesToolBody({
        rootPath: input.filesRootPath,
        selectedPath: input.filesSelectedPath,
        selectedEntryPath: input.filesSelectedEntryPath,
        openTabs: input.filesOpenTabs,
        activeTabPath: input.filesActiveTabPath,
        contentByPath: input.filesContentByPath,
        dirtyByPath: input.filesDirtyByPath,
        loadingFileByPath: input.filesLoadingFileByPath,
        savingFileByPath: input.filesSavingFileByPath,
        readOnlyByPath: input.filesReadOnlyByPath,
        sizeByPath: input.filesSizeByPath,
        expandedByPath: input.filesExpandedByPath,
        entriesByPath: input.filesEntriesByPath,
        loadingByPath: input.filesLoadingByPath,
        columnWidths: input.filesColumnWidths,
        sidebarWidth: input.filesSidebarWidth,
        sidebarCollapsed: input.filesSidebarCollapsed,
        findOpen: input.filesFindOpen,
        findQuery: input.filesFindQuery,
        replaceQuery: input.filesReplaceQuery,
        findCaseSensitive: input.filesFindCaseSensitive,
        lineWrap: input.filesLineWrap,
        error: input.filesError
      })
    },
    flow: {
      actionsHtml: renderFlowToolActions({
        runs: input.flowRuns,
        activeRunId: activeFlowRunId,
        mode: input.flowMode,
        maxIterations: input.flowMaxIterations,
        dryRun: input.flowDryRun,
        autoPush: input.flowAutoPush,
        promptPlanPath: input.flowPromptPlanPath,
        promptBuildPath: input.flowPromptBuildPath,
        planPath: input.flowPlanPath,
        specsGlob: input.flowSpecsGlob,
        implementCommand: input.flowImplementCommand,
        backpressureCommands: input.flowBackpressureCommands,
        eventFilter: input.flowEventFilter,
        filteredEvents: input.filteredFlowEvents,
        validationResults: input.flowValidationResults,
        busy: input.flowBusy,
        message: input.flowMessage
      }),
      bodyHtml: renderFlowToolBody({
        runs: input.flowRuns,
        activeRunId: activeFlowRunId,
        mode: input.flowMode,
        maxIterations: input.flowMaxIterations,
        dryRun: input.flowDryRun,
        autoPush: input.flowAutoPush,
        promptPlanPath: input.flowPromptPlanPath,
        promptBuildPath: input.flowPromptBuildPath,
        planPath: input.flowPlanPath,
        specsGlob: input.flowSpecsGlob,
        implementCommand: input.flowImplementCommand,
        backpressureCommands: input.flowBackpressureCommands,
        eventFilter: input.flowEventFilter,
        filteredEvents: input.filteredFlowEvents,
        validationResults: input.flowValidationResults,
        busy: input.flowBusy,
        message: input.flowMessage
      })
    },
    tasks: {
      actionsHtml: renderTasksToolActions({
        tasksById: input.tasksById,
        selectedId: input.tasksSelectedId,
        folder: input.tasksFolder,
        sortKey: input.tasksSortKey,
        sortDirection: input.tasksSortDirection,
        detailsCollapsed: input.tasksDetailsCollapsed,
        jsonDraft: input.tasksJsonDraft
      }),
      bodyHtml: renderTasksToolBody({
        tasksById: input.tasksById,
        selectedId: input.tasksSelectedId,
        folder: input.tasksFolder,
        sortKey: input.tasksSortKey,
        sortDirection: input.tasksSortDirection,
        detailsCollapsed: input.tasksDetailsCollapsed,
        jsonDraft: input.tasksJsonDraft
      })
    },
    memory: {
      actionsHtml: renderMemoryToolActions(),
      bodyHtml: renderMemoryToolBody()
    },
    skills: {
      actionsHtml: renderSkillsToolActions(),
      bodyHtml: renderSkillsToolBody()
    }
  };
}
