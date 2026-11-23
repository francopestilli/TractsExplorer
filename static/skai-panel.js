// SKAI side panel: chat with brainlife.io's assistant on the left; links to
// this explorer in its answers open here (window.teExplorer.applyView).
// Rendered by explorer.html only when config.skai.url is set.
(function () {
  var STARTERS = [
    'Which tracts decode most strongly to language?',
    'Describe cluster 1 and its top topics',
    'Show the network overlap of the left arcuate on TY7',
    'Which topics does this tract decode to?'
  ];

  function storage() { try { return window.localStorage; } catch (e) { return null; } }
  function explorerBase() { return location.origin + location.pathname; }
  function narrow() { return window.matchMedia && window.matchMedia('(max-width: 900px)').matches; }

  Vue.component('skai-panel', {
    props: ['config'],

    template: `
  <aside class="skai-panel" :class="{ collapsed: !open || !signedIn, drawer: isNarrow }" aria-label="SKAI assistant">
    <div v-if="!signedIn" class="skai-rail">
      <a class="skai-login" :href="loginHref()" @click.prevent="login">{{ status === 'login' ? 'Your brainlife login expired — log in again to ask SKAI' : 'Log in to ask SKAI' }}</a>
    </div>
    <div v-else-if="!open" class="skai-rail">
      <button class="skai-rail-btn" @click="toggle" aria-label="Open the SKAI assistant" title="Ask SKAI">
        <span class="skai-mark">SKAI</span><span aria-hidden="true">»</span>
      </button>
    </div>
    <template v-else>
      <div class="skai-head">
        <span class="skai-title">SKAI</span>
        <span class="skai-sub">brainlife.io assistant</span>
        <button class="icon-btn skai-collapse" @click="toggle" aria-label="Collapse the SKAI panel" title="Collapse">«</button>
      </div>
      <div v-if="status === 'offline'" class="skai-banner">
        SKAI is offline — <button class="skai-linkbtn" @click="retry">retry</button>
      </div>
      <div class="skai-log" ref="log" @click="onLogClick">
        <p class="skai-welcome">Ask about the tract decoding results — answers open here in the explorer.</p>
        <div v-if="!messages.length" class="skai-starters">
          <button v-for="q in starters" :key="q" class="skai-starter" :disabled="status !== 'ready'" @click="ask(q)">{{ q }}</button>
        </div>
        <div v-for="m in messages" :key="m.id" class="skai-msg" :class="m.role">
          <div v-if="m.role === 'user'" class="skai-bubble">{{ m.text }}</div>
          <template v-else>
            <div class="skai-md" v-html="m.html"></div>
            <div v-if="m.form && m.form.options.length" class="skai-starters">
              <button v-for="o in m.form.options" :key="o" class="skai-starter"
                :disabled="status !== 'ready' || pendingForm !== m.form" @click="ask(o)">{{ o }}</button>
            </div>
            <button v-if="m.view" class="skai-chip" @click="show(m.view)" title="Open this view in the explorer">Showing: {{ m.summary }}</button>
          </template>
        </div>
        <div v-if="thinking" class="skai-thinking">{{ thinking }}</div>
      </div>
      <form class="skai-input" @submit.prevent="ask(draft)">
        <textarea v-model="draft" rows="2" placeholder="Ask SKAI…" aria-label="Ask SKAI"
          @keydown.enter.exact.prevent="ask(draft)"></textarea>
        <button class="btn small" type="submit" :disabled="status !== 'ready' || !draft.trim()">Ask</button>
      </form>
      <p v-if="status === 'connecting'" class="skai-note">Connecting to SKAI…</p>
    </template>
  </aside>`,

    data: function () {
      return {
        jwt: TESkai.getJwt(storage()),
        status: null,
        open: !narrow(),
        isNarrow: narrow(),
        messages: [],
        thinking: '',
        pendingForm: null,   // SKAI asked a question back: the next reply answers it
        draft: '',
        starters: STARTERS
      };
    },

    computed: {
      signedIn: function () { return !!this.jwt && this.status !== 'login'; }
    },

    mounted: function () {
      var self = this;
      if (window.matchMedia) {
        this._mq = window.matchMedia('(max-width: 900px)');
        this._onMq = function () { self.isNarrow = self._mq.matches; self.open = !self._mq.matches; };
        if (this._mq.addEventListener) this._mq.addEventListener('change', this._onMq);
      }
      if (!this.jwt) return;
      this.client = TESkai.createClient({
        skaiUrl: this.config.skai.url, jwt: this.jwt,
        fetch: window.fetch.bind(window), WebSocket: window.WebSocket
      });
      this.client.onStatus(function (s) { self.status = s; if (s !== 'ready') self.thinking = ''; });
      this.client.onMessage(function (m) { self.receive(m); });
      this.client.connect().catch(function () {});   // status shows the outcome
    },

    beforeDestroy: function () {
      if (this.client) this.client.close();
      if (this._mq && this._mq.removeEventListener) this._mq.removeEventListener('change', this._onMq);
    },

    methods: {
      // Built at click time: the address bar follows the explorer's view.
      loginHref: function () {
        return this.config.skai.loginUrl + '?redirect=' + encodeURIComponent(location.href);
      },
      login: function () { location.assign(this.loginHref()); },
      toggle: function () {
        this.open = !this.open;
        // The explorer's width changed: let size-dependent views refit.
        this.$nextTick(function () { window.dispatchEvent(new Event('resize')); });
      },
      retry: function () { if (this.client) this.client.retry().catch(function () {}); },

      // What the explorer shows, for the context line SKAI gets with a question.
      viewContext: function () {
        var ex = window.teExplorer;
        if (!ex) return null;
        var v = { thr: ex.thresholdFolder };
        var cur = ex.currentView || {};
        for (var k in cur) v[k] = cur[k];
        return v;
      },

      ask: function (text) {
        text = String(text || '').trim();
        if (!text || !this.client || this.status !== 'ready') return;
        var form = this.pendingForm;
        var sent = form ? this.client.answer(form, text) : this.client.ask(text, this.viewContext());
        if (!sent) return;
        this.pendingForm = null;
        this.push({ role: 'user', text: text });
        this.draft = '';
        this.thinking = 'Thinking…';
      },

      receive: function (m) {
        var c = TESkai.classify(m);
        if (c.kind === 'thinking') { this.thinking = c.text; this.scroll(); return; }
        if (c.kind === 'timeout') {
          if (!this.thinking) return;
          this.thinking = '';
          this.push({ role: 'agent', html: TESkai.renderMarkdown(c.text) });
          return;
        }
        var base = explorerBase(), cfg = this.config;
        var isInternal = function (url) { return TEView.fromUrl(url, base, cfg) !== null; };
        if (c.kind === 'form') {
          this.thinking = '';
          this.pendingForm = c;
          this.push({ role: 'agent', html: TESkai.renderMarkdown(c.text, isInternal), form: c });
          return;
        }
        if (c.kind !== 'text') return;
        this.pendingForm = null;
        var views = TESkai.explorerLinks(c.text, base, cfg);
        var last = views.length ? views[views.length - 1] : null;
        this.thinking = '';
        this.push({
          role: 'agent',
          html: TESkai.renderMarkdown(c.text, isInternal),
          view: last,
          summary: last ? TESkai.summarize(last) : ''
        });
        if (last) this.show(last);
      },

      show: function (view) {
        if (window.teExplorer) window.teExplorer.applyView(view);
        if (this.isNarrow) this.open = false;   // drawer: reveal the explorer
      },

      // Explorer links inside answers open in place instead of reloading.
      onLogClick: function (e) {
        var a = e.target.closest && e.target.closest('a.skai-explorer-link');
        if (!a) return;
        var view = TEView.fromUrl(a.href, explorerBase(), this.config);
        if (view === null) return;
        e.preventDefault();
        this.show(view);
      },

      push: function (msg) {
        this._seq = (this._seq || 0) + 1;
        msg.id = this._seq;
        this.messages.push(msg);
        this.scroll();
      },
      scroll: function () {
        var self = this;
        this.$nextTick(function () { var el = self.$refs.log; if (el) el.scrollTop = el.scrollHeight; });
      }
    }
  });
})();
