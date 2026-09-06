<script setup lang="ts">
import { computed, onBeforeMount, onBeforeUnmount, onMounted, reactive, ref, type Ref } from 'vue';
import { useI18n } from "vue-i18n";
import useI18nStore from "../store/i18n";
import { minimalSetup } from "codemirror"
import { EditorState } from "@codemirror/state"
import { EditorView, lineNumbers, highlightSpecialChars, drawSelection, dropCursor } from "@codemirror/view"
import { DeleteFile, GetFile, ListFiles, PutFile } from "@/api";
import { formatBytes, getRandomFilename } from "@/utils/utils";
import useClipStore from "@/store/clip";
import useFileStore from "@/store/file";
import type { _Object } from '@aws-sdk/client-s3';

type FileItem = _Object & {
  Metadata?: Record<string, string>;
};

const MAX_INLINE_TEXT_SIZE = 1024 * 1024;

const i18nStore = useI18nStore();
const updateLocale = (locale: string) => {
  i18nStore.setLocale(locale);
};

const { locale, t } = useI18n();
if (i18nStore.locale !== "") {
  locale.value = i18nStore.locale;
}

/* ---------- 剪贴板编辑器 ---------- */
const code = ref("");
const modified = ref(false);
const editorElement = ref();
let editor: EditorView;

const startState = EditorState.create({
  doc: "",
  extensions: [
    minimalSetup,
    lineNumbers(),
    highlightSpecialChars(),
    drawSelection(),
    // 文件拖动
    dropCursor(),
    EditorView.updateListener.of((update) => {
      code.value = update.state.doc.toString();
      if (update.docChanged) {
        modified.value = true;
      }
    }),
  ]
})

const filename = ref(getRandomFilename());

const refreshRandomFileName = () => {
  filename.value = getRandomFilename();
}

const clipStore = useClipStore();

const onSaveBtnClick = async () => {
  await PutFile(filename.value, code.value, clipStore.visibility, "text");
  modified.value = false;
}

const saveContentKeydown = (e: KeyboardEvent) => {
  if ((e.ctrlKey && e.key === "s") || (e.metaKey && e.key === "s")) {
    e.preventDefault();
    onSaveBtnClick();
  }
}

const onPasteFile = async (e: ClipboardEvent) => {
  if (!e.clipboardData?.files.length) {
    return;
  }
  const file = e.clipboardData.files[0];
  const text = await file.text();
  const cursor = editor.state.selection.main.head;
  editor.dispatch({
    changes: { from: cursor, insert: text },
  });
}

/* ---------- 文件上传 ---------- */
const fileStore = useFileStore();

const fileUploadInput = ref();

const requestUploadFile = () => {
  fileUploadInput.value.click();
}

const uploading = ref(0);

const uploadFiles = async (files: FileList) => {
  const list = Array.from(files);
  uploading.value = list.length;
  for (const file of list) {
    try {
      await PutFile(file.name, file, fileStore.visibility, "file");
    } catch (error) {
      console.error(error);
    }
    uploading.value -= 1;
  }
  await refreshFiles();
}

const fileUploadArea = ref();

const onDragEvent = async (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  if (event.type === 'dragover') {
    fileUploadArea.value.style.border = '2px dashed #000';
  } else {
    fileUploadArea.value.style.border = '2px dashed #e5e7eb';
  }
  if (event.type === 'drop') {
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      uploadFiles(files);
    }
  }
}

/* ---------- 文件列表 ---------- */
const uploadedFiles: Ref<FileItem[]> = ref([]);

const textContents = reactive<Record<string, string>>({});

const isInlineText = (item: FileItem) =>
  item.Metadata?.['x-store-type'] === 'text' && (item.Size ?? 0) <= MAX_INLINE_TEXT_SIZE;

const textItems = computed(() => uploadedFiles.value.filter(isInlineText));
const fileItems = computed(() => uploadedFiles.value.filter((item) => !isInlineText(item)));

const fetchTextContent = async (item: FileItem) => {
  try {
    textContents[item.Key!] = await GetFile(item.Key!);
  } catch (e) {
    // 内容拉取失败时保持占位,不影响文件形态
  }
};

const refreshFiles = async () => {
  const res = await ListFiles();
  if (res.hasOwnProperty('Contents') && res.Contents) {
    uploadedFiles.value = res.Contents as FileItem[];
    for (const item of uploadedFiles.value) {
      if (isInlineText(item) && textContents[item.Key!] === undefined) {
        fetchTextContent(item);
      }
    }
  } else {
    uploadedFiles.value = [];
  }
};

const editTextItem = async (item: FileItem) => {
  const content = textContents[item.Key!] ?? await GetFile(item.Key!);
  textContents[item.Key!] = content;
  filename.value = item.Key!;
  code.value = content;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } });
  modified.value = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const onDeleteItemClick = async (key?: string) => {
  if (!key) return;
  if (!confirm(t('common.delete_confirm'))) return;
  await DeleteFile(key);
  uploadedFiles.value = uploadedFiles.value.filter((item) => item.Key !== key);
  delete textContents[key];
};

function decodeKey(key: string) {
  return decodeURIComponent(key)
}

/* ---------- 生命周期 ---------- */
onBeforeMount(async () => {
  await refreshFiles();
});

onMounted(() => {
  editor = new EditorView({
    state: startState,
    parent: editorElement.value,
  })
  editor.requestMeasure({
    read: () => {
      editor.focus();
    }
  })
  fileUploadInput.value.addEventListener('change', (event: Event) => {
    const target = event.target as HTMLInputElement;
    const { files } = target;
    if (files && files.length > 0) {
      uploadFiles(files);
    }
  });
  fileUploadArea.value.addEventListener('dragenter', onDragEvent);
  fileUploadArea.value.addEventListener('dragover', onDragEvent);
  fileUploadArea.value.addEventListener('dragleave', onDragEvent);
  fileUploadArea.value.addEventListener('drop', onDragEvent);
  window.addEventListener("keydown", saveContentKeydown);
  document.addEventListener("paste", onPasteFile);
});

onBeforeUnmount(() => {
  fileUploadArea.value.removeEventListener('dragenter', onDragEvent);
  fileUploadArea.value.removeEventListener('dragover', onDragEvent);
  fileUploadArea.value.removeEventListener('dragleave', onDragEvent);
  fileUploadArea.value.removeEventListener('drop', onDragEvent);
  window.removeEventListener("keydown", saveContentKeydown);
  document.removeEventListener("paste", onPasteFile);
});
</script>

<template>
  <div class="flex flex-col items-center">
    <!-- 文件上传 -->
    <div class="pannel">
      <div class="text-2xl">{{ $t("index.file_channel_title") }}</div>
      <div class="file-area flex flex-col mt-2">
        <div class="files" @click="requestUploadFile" ref="fileUploadArea">
          <input ref="fileUploadInput" type="file" class="hidden" multiple />
        </div>
        <div class="footer p-2">
          <select class="public-select" v-model="fileStore.visibility">
            <option value="private">{{ $t('common.private') }}</option>
            <option value="public">{{ $t('common.public') }}</option>
          </select>
          <div v-if="uploading > 0" class="uploading-indicator ml-2"></div>
        </div>
      </div>
    </div>

    <!-- 剪贴板 -->
    <div class="pannel">
      <div class="text-2xl">{{ $t("index.clip_channel_title") }}</div>
      <div class="text-area flex flex-col mt-2">
        <div class="header p-2 flex flex-row items-center">
          <input class="filename-input monospace" type="text" v-model="filename" :placeholder="$t('common.filename')" />
          <button @click="refreshRandomFileName" class="i-mdi-refresh ml-1 w-5 h-5"></button>
          <div :class="modified ? 'unsave-attention' : 'save-attention'"></div>
        </div>
        <div ref="editorElement"></div>
        <div class="footer p-2">
          <select class="public-select" v-model="clipStore.visibility">
            <option value="private">{{ $t('common.private') }}</option>
            <option value="public">{{ $t('common.public') }}</option>
          </select>
          <button class="save-btn" @click="onSaveBtnClick">{{ $t('common.save') }}</button>
        </div>
      </div>
    </div>

    <!-- 文件列表 -->
    <div class="pannel file-list-pannel">
      <div class="text-2xl">{{ $t("page_title.filemanage") }}</div>
      <div v-for="item in textItems" :key="item.Key"
        class="w-full mt-4 rounded border-1 border-gray-300 px-2 py-1">
        <div class="flex flex-row items-center">
          <div class="w-6 h-6 i-mdi-text-box-outline"></div>
          <a class="text-sm text-gray title ml-1" :title="decodeKey(item.Key!)" :href="`/${item.Key}`" target="_blank">{{ decodeKey(item.Key!) }}</a>
          <div class="ml-auto flex flex-row items-center">
            <div class="w-6 h-6 i-mdi-pencil-outline cursor-pointer" @click="editTextItem(item)"></div>
            <a class="w-6 h-6 i-mdi-download-outline cursor-pointer ml-2" :title="$t('common.download')" :href="`/${item.Key}`" download></a>
            <div class="w-6 h-6 i-mdi-trash-can-outline cursor-pointer ml-2" @click="onDeleteItemClick(item.Key)"></div>
          </div>
        </div>
        <pre v-if="textContents[item.Key!] !== undefined" class="text-preview">{{ textContents[item.Key!] }}</pre>
        <div v-else class="text-sm text-gray my-2">...</div>
      </div>
      <div v-for="file in fileItems" :key="file.Key"
        class="w-full flex flex-row items-center mt-4 rounded border-1 border-gray-300 px-2 py-1">
        <div class="w-10 h-10 i-mdi-file-document-outline"></div>
        <div class="flex flex-col title flex-1 min-w-0">
          <a class="text-lg font-semibold" :title="decodeKey(file.Key!)" :href="`/${file.Key}`" target="_blank">{{ decodeKey(file.Key!) }}</a>
          <div class="text-sm text-gray">{{ formatBytes(file.Size ?? 0) }}</div>
        </div>
        <div class="ml-auto flex flex-row items-center">
          <a class="w-6 h-6 i-mdi-download-outline cursor-pointer" :title="$t('common.download')" :href="`/${file.Key}`" download></a>
          <div class="w-6 h-6 i-mdi-trash-can-outline cursor-pointer ml-2" @click="onDeleteItemClick(file.Key)"></div>
        </div>
      </div>
    </div>

    <select v-model="$i18n.locale" class="locale-changer" @change="updateLocale($i18n.locale)">
      <option v-for="locale in $i18n.availableLocales" :key="`locale-${locale}`" :value="locale">{{ locale }}</option>
    </select>
  </div>
</template>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  background-color: #f8f9fa;
}

.pannel {
  --uno: my-6 px-4 py-4 max-w-screen-md w-4/5 rounded shadow-md;
}

.file-list-pannel {
  background-color: #f8f9fa;
}

.file-area {
  --uno: rounded border-1 border-gray-300;
  background-color: white;
}

.file-area .footer {
  --uno: flex flex-row;
  background-color: #f5f5f5;
}

.public-select {
  --uno: border-1 rounded px-6 py-1.5 text-sm;
  border-color: #d1d1d1;
  outline-color: #0969da;
}

.files {
  --uno: h-50 border-dashed border-2 cursor-pointer;
  background: url(../assets/upload.svg) center center no-repeat;
  background-color: white;
}

.text-area {
  --uno: rounded border-1 border-gray-300;
  background-color: white;
}

.text-area .header {
  background-color: #f5f5f5;
}

.text-area .footer {
  --uno: flex flex-row;
  background-color: #f5f5f5;
}

.save-btn {
  --uno: rounded px-6 py-1.5 text-sm ml-auto text-white;
  background-color: #1f883d;
}

.save-btn:hover {
  background-color: #1a7f37;
}

.filename-input {
  --uno: border-1 rounded px-3 py-2 text-sm w-60;
  border-color: #d1d1d1;
  outline-color: #0969da;
}

.cm-editor {
  height: 400px;
  border-top: 1px solid #ddd;
  border-bottom: 1px solid #ddd;
}

.cm-editor.cm-focused {
  outline: none;
}

.cm-gutter.cm-lineNumbers {
  background-color: white;
}

.cm-gutters {
  border: none !important;
}

.cm-selectionBackground {
  background-color: #54aeff66 !important;
}

.unsave-attention {
  --uno: i-mdi-circle-small w-8 h-8 ml-auto;
  color: #9a6700 !important;
}

.save-attention {
  --uno: i-mdi-circle-small w-8 h-8 ml-auto;
  color: #1f883d !important;
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text-preview {
  margin: 8px 0;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 0.875rem;
  color: #333;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.uploading-indicator {
  border: 3px solid #f3f3f3;
  border-top: 3px solid #555;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: inline-block;
  animation: spin 2s linear infinite;
}

.locale-changer {
  border: grey 1px solid;
  border-radius: 6px;
  padding: 2px 4px;
}
</style>
