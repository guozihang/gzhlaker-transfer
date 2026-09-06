import { createRouter, createWebHashHistory } from "vue-router";
import Cookies from 'js-cookie'
import i18n from "./i18n";

import IndexPage from "./pages/IndexPage.vue";
import LoginPage from "./pages/LoginPage.vue";

const $t = i18n.global.t;

const routes = [
    {
        path: "/",
        name: "index",
        meta: {
            title: $t("page_title.index"),
        },
        component: IndexPage,
    },
    {
        path: "/login",
        name: "login",
        meta: {
            title: $t("page_title.login"),
        },
        component: LoginPage,
    },
    {
        path: "/clip",
        redirect: "/",
    },
    {
        path: "/file",
        redirect: "/",
    },
    {
        path: "/filemanage",
        redirect: "/",
    },
];

const router = createRouter({
    history: createWebHashHistory(),
    routes,
});

router.beforeEach((to, from, next) => {
    if (to.meta.title) {
        document.title = to.meta.title as string;
    }
    const PASSWORD = Cookies.get('PASSWORD');
    if (!PASSWORD && to.path !== '/login') {
        next({
            path: '/login',
        })
    } else {
        next()
    }
})

export default router;