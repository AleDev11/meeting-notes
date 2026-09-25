import { contextBridge, ipcRenderer } from 'electron'
import type {
  AudioChannel,
  Folder,
  LiveEvent,
  Meeting,
  MeetingSummary,
  RecordingTrack,
  ScreenSource,
  SearchResult,
  PromptTemplate,
  Settings,
  SpeakerSuggestion,
  MiniCommand,
  MiniState,
  SummaryEvent,
  UpdateState
} from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api = {
  getSettings: (): Promise<Settings> => invoke('settings:get'),
  saveSettings: (s: Settings): Promise<void> => invoke('settings:save', s),
  getDefaults: (): Promise<{ prompts: PromptTemplate[]; speakerIdPrompt: string }> =>
    invoke('settings:defaults'),
  appInfo: (): Promise<{ version: string; packaged: boolean; libraryDir: string }> => invoke('app:info'),
  publishRecordingState: (s: { recording: boolean; paused: boolean }): void => ipcRenderer.send('recording:state', s),
  quitApp: (): Promise<void> => invoke('app:quit'),

  listLibrary: (): Promise<{ folders: Folder[]; meetings: MeetingSummary[] }> =>
    invoke('library:list'),
  openLibrary: (): Promise<string> => invoke('library:open'),
  searchLibrary: (text: string): Promise<SearchResult[]> => invoke('library:search', text),
  openExternal: (url: string): Promise<void> => invoke('app:openExternal', url),

  getUpdateState: (): Promise<UpdateState> => invoke('update:get'),
  checkForUpdates: (): Promise<void> => invoke('update:check'),
  installUpdate: (): Promise<void> => invoke('update:install'),

  createFolder: (name: string, parentId: string | null): Promise<Folder> =>
    invoke('folder:create', name, parentId),
  updateFolder: (f: Folder): Promise<void> => invoke('folder:update', f),
  deleteFolder: (id: string): Promise<void> => invoke('folder:delete', id),
  reorderFolders: (u: Pick<Folder, 'id' | 'parentId' | 'order'>[]): Promise<void> =>
    invoke('folder:reorder', u),

  createMeeting: (folderId: string | null): Promise<Meeting> => invoke('meeting:create', folderId),
  getMeeting: (id: string): Promise<Meeting | null> => invoke('meeting:get', id),
  patchMeeting: (
    id: string,
    patch: Pick<Partial<Meeting>, 'title' | 'sections' | 'summary' | 'summaryPromptId'>
  ): Promise<void> => invoke('meeting:patch', id, patch),
  deleteMeeting: (id: string): Promise<void> => invoke('meeting:delete', id),
  reorderMeetings: (u: Pick<Meeting, 'id' | 'folderId' | 'order'>[]): Promise<void> =>
    invoke('meeting:reorder', u),
  retranscribe: (id: string): Promise<void> => invoke('meeting:retranscribe', id),
  exportMeeting: (id: string): Promise<void> => invoke('meeting:export', id),

  renameSpeaker: (meetingId: string, speakerId: string, name: string): Promise<void> =>
    invoke('speaker:rename', meetingId, speakerId, name),
  mergeSpeakers: (meetingId: string, fromId: string, intoId: string): Promise<void> =>
    invoke('speaker:merge', meetingId, fromId, intoId),
  reassignSegments: (meetingId: string, segmentIds: string[], speakerId: string): Promise<void> =>
    invoke('segment:reassign', meetingId, segmentIds, speakerId),
  editSegment: (meetingId: string, segmentId: string, text: string): Promise<void> =>
    invoke('segment:edit', meetingId, segmentId, text),
  suggestSpeakers: (meetingId: string): Promise<SpeakerSuggestion[]> =>
    invoke('speaker:suggest', meetingId),

  startRecording: (meetingId: string, channels: AudioChannel[], withScreen: boolean): Promise<void> =>
    invoke('recording:start', meetingId, channels, withScreen),
  listScreens: (): Promise<ScreenSource[]> => invoke('screens:list'),
  selectScreen: (displayId: string): Promise<void> => invoke('screens:select', displayId),
  showScreenFile: (id: string): Promise<void> => invoke('meeting:showScreenFile', id),
  sendPcm: (channel: AudioChannel, chunk: Uint8Array): void =>
    ipcRenderer.send('recording:pcm', channel, chunk),
  sendWebm: (meetingId: string, track: RecordingTrack, chunk: Uint8Array): void =>
    ipcRenderer.send('recording:webm', meetingId, track, chunk),
  stopRecording: (meetingId: string, durationSec: number): Promise<void> =>
    invoke('recording:stop', meetingId, durationSec),

  generateSummary: (id: string, promptId: string): Promise<string> =>
    invoke('summary:generate', id, promptId),

  onLiveEvent: (cb: (e: LiveEvent) => void) => subscribe('live:event', cb),
  onMeetingUpdated: (cb: (m: Meeting) => void) => subscribe('meeting:updated', cb),
  onSummaryDelta: (cb: (e: SummaryEvent) => void) => subscribe('summary:delta', cb),
  onUpdateState: (cb: (s: UpdateState) => void) => subscribe('update:state', cb),

  openMini: (): Promise<void> => invoke('mini:open'),
  closeMini: (): Promise<void> => invoke('mini:close'),
  publishMiniState: (s: MiniState): void => ipcRenderer.send('mini:state', s),
  getMiniState: (): Promise<MiniState | null> => invoke('mini:state'),
  sendMiniCommand: (cmd: MiniCommand): void => ipcRenderer.send('mini:command', cmd),
  onMiniState: (cb: (s: MiniState) => void) => subscribe('mini:state', cb),
  onMiniCommand: (cb: (cmd: MiniCommand) => void) => subscribe('mini:command', cb),
  onMiniClosed: (cb: () => void) => subscribe('mini:closed', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
