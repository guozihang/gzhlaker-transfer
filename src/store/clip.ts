import { defineStore } from 'pinia'
import { ref } from 'vue'

const useClipStore = defineStore(
    'clip',
    () => {
        const visibility = ref("public");

        return { visibility }
    },
    {
        persist: true,
    }
)

export default useClipStore
