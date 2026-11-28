import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { readCsrfToken, refreshCsrf } from './api/client';
import router from './router';
import { useAuthStore } from './stores/auth';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/utilities.css';

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.use(router);

// Warm the session (header render) and make sure an `aip_csrf` cookie exists
// before the first form submission; both calls are safe when the API is down.
void useAuthStore(pinia).ensureLoaded();
if (!readCsrfToken()) void refreshCsrf();

app.mount('#app');