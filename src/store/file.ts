import { defineStore } from 'pinia'
import { ref } from 'vue'

const useFileStore = defineStore(
    'file',
    () => {
        const visibility = ref("public");

        return { visibility }
    },
    {
        persist: true,
    }
)

export default useFileStore
