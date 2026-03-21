// ===================================================================
// FontRig — AI Agent Panel (Multi-Instance)
// ===================================================================
// Chat interface for AI-powered font editing assistance.
// Supports Ollama (local) and Gemini (cloud) providers.
//
// Depends on:
//   - pyodide-bridge.js for TypeRig context and code execution
//   - FontRig.state for glyph/font data
//
// Supports multiple instances: each mount() creates fresh DOM.
// Messages are NOT shared between instances (each chat is independent).
//
// CONFIG: Edit ai-agent-config.json to customize models, providers, etc.
// ===================================================================
'use strict';

// ===================================================================
// Namespace
// ===================================================================
FontRig.AiAgentPanel = {};

// ===================================================================
// Shared state
// ===================================================================
FontRig.AiAgentPanel._history = [];
FontRig.AiAgentPanel._historyIdx = -1;

// ===================================================================
// AI API Bridge
// ===================================================================
FontRig.AiAgentBridge = {

    _configLoaded: false,
    _configUrl: 'js/panels/ai-agent-config.json',
    _apiRefLoaded: false,
    _apiReference: '',

    providers: {},

    loadConfig: function(callback) {
        var self = this;
        if (this._configLoaded && callback) {
            callback();
            return;
        }
        
        Promise.all([
            fetch(this._configUrl).then(function(r) { return r.json(); }),
            fetch('js/panels/ai-agent-api.json').then(function(r) { return r.json(); }).catch(function() { return null; })
        ]).then(function(results) {
            var config = results[0];
            var apiRef = results[1];
            
            self.providers = config.providers;
            if (config.autoExecute) {
                self.autoExecute = config.autoExecute;
            }
            if (apiRef) {
                self._apiReference = self._buildApiPrompt(apiRef);
            }
            self.currentProvider = 'ollama';
            self.currentModel = self.providers.ollama.defaultModel;
            self._configLoaded = true;
            if (callback) callback();
        }).catch(function(e) {
            console.warn('Failed to load AI config, using defaults:', e);
            self._loadDefaults();
            if (callback) callback();
        });
    },

    _buildApiPrompt: function(apiRef) {
        var lines = [];
        lines.push('\n\n=== TYPERIG API REFERENCE ===\n');
        
        for (var className in apiRef.classes) {
            var cls = apiRef.classes[className];
            lines.push('\n## ' + className);
            if (cls.description) lines.push('Description: ' + cls.description);
            
            if (cls.properties) {
                lines.push('Properties:');
                for (var prop in cls.properties) {
                    lines.push('  .' + prop + ' -> ' + cls.properties[prop]);
                }
            }
            if (cls.methods) {
                lines.push('Methods:');
                for (var method in cls.methods) {
                    lines.push('  .' + method + '() -> ' + cls.methods[method]);
                }
            }
        }
        
        if (apiRef.functions) {
            lines.push('\n## Functions');
            for (var cat in apiRef.functions) {
                lines.push('(' + cat + ')');
                for (var fn in apiRef.functions[cat]) {
                    lines.push('  ' + fn + ' -> ' + apiRef.functions[cat][fn]);
                }
            }
        }
        
        if (apiRef.usage_examples) {
            lines.push('\n## Usage Examples');
            for (var example in apiRef.usage_examples) {
                lines.push('  ' + example + ': ' + apiRef.usage_examples[example]);
            }
        }
        
        if (apiRef.known_limitations) {
            lines.push('\n## Limitations in Browser');
            for (var i = 0; i < apiRef.known_limitations.length; i++) {
                lines.push('  - ' + apiRef.known_limitations[i]);
            }
        }
        
        lines.push('\n=== END API REFERENCE ===\n');
        return lines.join('\n');
    },

    _loadDefaults: function() {
        this.providers = {
            ollama: {
                name: 'Ollama (Local)',
                baseUrl: 'http://localhost:11434',
                defaultModel: 'llama3.2',
                models: [
                    { id: 'llama3.2', name: 'Llama 3.2' }
                ]
            },
            gemini: {
                name: 'Google Gemini (Cloud)',
                defaultModel: 'gemini-2.0-flash',
                models: [
                    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }
                ]
            }
        };
        this.autoExecute = {
            enabled: true,
            trigger: '<!--EXECUTE-->',
            selfCorrect: true,
            maxIterations: 3
        };
        this.currentProvider = 'ollama';
        this.currentModel = 'llama3.2';
        this._configLoaded = true;
    },

    getAutoExecute: function() {
        return this.autoExecute || { 
            enabled: false, 
            trigger: '<!--EXECUTE-->', 
            selfCorrect: true,
            maxIterations: 3
        };
    },

    getApiKey: function(provider) {
        return sessionStorage.getItem('ai-api-key-' + provider) || '';
    },

    setApiKey: function(provider, key) {
        if (key) {
            sessionStorage.setItem('ai-api-key-' + provider, key);
        } else {
            sessionStorage.removeItem('ai-api-key-' + provider);
        }
    },

    getBaseUrl: function(provider) {
        return sessionStorage.getItem('ai-base-url-' + provider) || this.providers[provider].baseUrl || '';
    },

    setBaseUrl: function(provider, url) {
        if (url) {
            sessionStorage.setItem('ai-base-url-' + provider, url);
        } else {
            sessionStorage.removeItem('ai-base-url-' + provider);
        }
    },

    // Build context about current font/glyph state
    buildContext: function() {
        var lines = [];
        lines.push('=== FONTRIG EDITOR CONTEXT ===\n');

        // Font info
        if (FontRig.font && FontRig.font.info) {
            var info = FontRig.font.info;
            lines.push('FONT:');
            lines.push('  Family: ' + (info.family || info.familyName || 'Unknown'));
            lines.push('  Style: ' + (info.style || info.styleName || 'Regular'));
            lines.push('  UPM: ' + (FontRig.font.metrics ? FontRig.font.metrics.upm : 'N/A'));
            if (FontRig.font.masters && FontRig.font.masters.length > 0) {
                lines.push('  Masters: ' + FontRig.font.masters.map(function(m) { return m.layerName || 'Master'; }).join(', '));
            }
            lines.push('');
        }

        // Current glyph
        if (FontRig.state.glyphData) {
            var glyph = FontRig.state.glyphData;
            lines.push('CURRENT GLYPH:');
            lines.push('  Name: ' + (glyph.name || 'unnamed'));
            if (glyph.unicodes) {
                try {
                    var unicodes = Array.isArray(glyph.unicodes) ? glyph.unicodes : [glyph.unicodes];
                    lines.push('  Unicode: ' + unicodes.map(function(u) { return 'U+' + parseInt(u).toString(16).toUpperCase(); }).join(', '));
                } catch(e) { lines.push('  Unicode: ' + glyph.unicodes); }
            }
            if (glyph.layers && Array.isArray(glyph.layers)) {
                lines.push('  Layers: ' + glyph.layers.map(function(l) { return l.name || 'unnamed'; }).join(', '));
            }
            lines.push('');
        }

        // Selected nodes
        if (FontRig.state.selectedNodeIds && FontRig.state.selectedNodeIds.size > 0) {
            lines.push('SELECTED NODES: ' + FontRig.state.selectedNodeIds.size + ' nodes selected');
            lines.push('');
        }

        // Active layer
        if (FontRig.state.activeLayer) {
            lines.push('ACTIVE LAYER: ' + FontRig.state.activeLayer);
            lines.push('');
        }

        // TypeRig Python available objects
        lines.push('TYPERIG PYTHON AVAILABLE:');
        lines.push('  glyph - Current glyph (from typerig.core.objects.glyph)');
        lines.push('  Node, Contour, Shape, Layer, Anchor');
        lines.push('  Transform, DeltaScale, Point, Line, PointArray');
        lines.push('');
        lines.push('USER QUESTION:');

        return lines.join('\n');
    },

    // Send message to AI provider (uses config type field)
    sendMessage: function(messages, onChunk, onComplete, onError) {
        var provider = this.currentProvider;
        var providerConfig = this.providers[provider];

        if (!providerConfig) {
            onError('Unknown provider: ' + provider);
            return;
        }

        var type = providerConfig.type || provider;
        if (type === 'ollama') {
            this._sendOllama(messages, onChunk, onComplete, onError);
        } else if (type === 'gemini') {
            this._sendGemini(messages, onChunk, onComplete, onError);
        } else {
            onError('Unsupported provider type: ' + type);
        }
    },

    // Ollama API — uses config for URLs
    _sendOllama: function(messages, onChunk, onComplete, onError) {
        var providerConfig = this.providers.ollama || {};
        var baseUrl = this.getBaseUrl('ollama') || providerConfig.baseUrl || 'http://localhost:11434';
        var apiEndpoint = providerConfig.apiEndpoint || '/api/chat';
        var model = this.currentModel;

        var systemPrompt = 'You are an expert in font design, TypeRig, and Python scripting for font editing. ' +
            'The user is working in FontRig, a browser-based font editor that uses TypeRig Python library. ' +
            'Help them with font editing tasks, Python scripts, geometry questions, and TypeRig API usage. ' +
            'When providing code, use Python syntax compatible with TypeRig core objects.\n\n' +
            '**Auto-execution:** If you want code to be automatically executed in the browser, add the line ' +
            '<!--EXECUTE--> on a separate line AFTER the code block.\n\n' +
            '**Self-correction:** If code produces an error during execution, I will send the error back to you ' +
            'and ask you to fix it. Be prepared to:\n' +
            '1. Analyze what went wrong\n' +
            '2. Provide corrected code\n' +
            '3. Add <!--EXECUTE--> to try again\n' +
            'Common issues: missing imports, wrong API usage, TypeRig object methods.\n\n' +
            'IMPORTANT: Only use API methods documented in the TypeRig API Reference below. ' +
            'Do not assume methods exist that are not documented.' +
            (this._apiReference || '');

        var ollamaMessages = messages.map(function(m) {
            return {
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.content
            };
        });

        var body = {
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: this.buildContext() }
            ].concat(ollamaMessages),
            stream: true
        };

        fetch(baseUrl + apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function(response) {
            if (!response.ok) {
                throw new Error('Ollama error: ' + response.status);
            }
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var fullResponse = '';

            function read() {
                reader.read().then(function(result) {
                    if (result.done) {
                        onComplete(fullResponse);
                        return;
                    }
                    var chunk = decoder.decode(result.value, { stream: true });
                    var lines = chunk.split('\n');
                    for (var i = 0; i < lines.length; i++) {
                        if (lines[i].trim()) {
                            try {
                                var data = JSON.parse(lines[i]);
                                if (data.message && data.message.content) {
                                    fullResponse += data.message.content;
                                    onChunk(data.message.content);
                                }
                                if (data.done) {
                                    onComplete(fullResponse);
                                    return;
                                }
                            } catch (e) { /* skip invalid JSON */ }
                        }
                    }
                    read();
                });
            }
            read();
        }).catch(function(err) {
            onError(err.message || 'Failed to connect to Ollama');
        });
    },

    // Gemini API — uses config for URLs
    _sendGemini: function(messages, onChunk, onComplete, onError) {
        var apiKey = this.getApiKey('gemini');
        var model = this.currentModel;
        var providerConfig = this.providers.gemini || {};

        // FALLBACK: If model is 'gemini-pro' or empty, use a valid 1.5 model to avoid 404
        if (!model || model === 'gemini-pro') {
            model = providerConfig.defaultModel || 'gemini-1.5-flash';
        }

        var geminiBase = providerConfig.baseUrl || 'https://generativelanguage.googleapis.com';
        var apiEndpoint = (providerConfig.apiEndpoint || '/v1beta/models/{model}:streamGenerateContent').replace('{model}', model);
        var corsProxy = sessionStorage.getItem('ai-cors-proxy-gemini') || providerConfig.corsProxy || '';
        var targetUrl = geminiBase + apiEndpoint + '?key=' + apiKey + '&alt=sse';
        var baseUrl = corsProxy ? corsProxy + targetUrl : targetUrl;

        var systemInstruction = 'You are an expert in font design, TypeRig, and Python scripting for font editing. ' +
            'The user is working in FontRig, a browser-based font editor that uses TypeRig Python library. ' +
            'Help them with font editing tasks, Python scripts, geometry questions, and TypeRig API usage. ' +
            'When providing code, use Python syntax compatible with TypeRig core objects. ' +
            'Format code blocks with ```python. Be concise and helpful.\n\n' +
            '**Auto-execution:** If you want code to be automatically executed in the browser, add the line ' +
            'on a separate line AFTER the code block.\n\n' +
            '**Self-correction:** If code produces an error, I will send it back for fixing.\n\n' +
            'IMPORTANT: Only use API methods documented in the TypeRig API Reference. ' +
            (this._apiReference || '');

        var contents = messages.map(function(m) {
            return {
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            };
        });

        // FIX 2: Prepend context to the very first user message if needed
        if (contents.length > 0 && contents[0].role === 'user') {
            contents[0].parts[0].text = this.buildContext() + '\n\n' + contents[0].parts[0].text;
        }

        var body = {
            contents: contents,
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            generationConfig: {
                maxOutputTokens: 8192,
                temperature: 0.7
            }
        };

        fetch(baseUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                // Explicitly tell the proxy we are making a cross-origin request
                'X-Requested-With': 'XMLHttpRequest' 
            },
            body: JSON.stringify(body)
        }).then(function(response) {
            if (!response.ok) {
                // Handle common proxy errors (like 403 if proxy access isn't granted)
                if (response.status === 403) throw new Error('CORS Proxy access denied. ' + (providerConfig.corsProxyNote || 'Check your CORS proxy settings.'));
                throw new Error('Gemini error: ' + response.status);
            }
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var fullResponse = '';

            function read() {
                reader.read().then(function(result) {
                    if (result.done) {
                        onComplete(fullResponse);
                        return;
                    }
                    var chunk = decoder.decode(result.value, { stream: true });
                    var lines = chunk.split('\n');
                    
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i].trim();
                        // FIX 3: Robust SSE parsing for "data: " lines
                        if (line.startsWith('data:')) {
                            try {
                                var jsonStr = line.replace(/^data:\s*/, '');
                                var data = JSON.parse(jsonStr);
                                if (data.candidates && data.candidates[0] && data.candidates[0].content) {
                                    var parts = data.candidates[0].content.parts;
                                    for (var j = 0; j < parts.length; j++) {
                                        if (parts[j].text) {
                                            fullResponse += parts[j].text;
                                            onChunk(parts[j].text);
                                        }
                                    }
                                }
                            } catch (e) { /* partial JSON chunk, skip */ }
                        }
                    }
                    read();
                });
            }
            read();
        }).catch(function(err) {
            onError(err.message || 'Failed to connect to Gemini');
        });
    },

    // Check provider status
    checkStatus: function(provider, onResult) {
        if (provider === 'ollama') {
            var providerConfig = this.providers.ollama || {};
            var baseUrl = this.getBaseUrl('ollama') || providerConfig.baseUrl || 'http://localhost:11434';
            var statusEndpoint = providerConfig.statusEndpoint || '/api/tags';
            fetch(baseUrl + statusEndpoint, { method: 'GET' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    onResult(true, 'Ollama ready - ' + (data.models ? data.models.length : 0) + ' models');
                })
                .catch(function(e) {
                    onResult(false, 'Ollama not available: ' + e.message);
                });
        } else {
            // Generic check for API-key-based providers (gemini, etc.)
            var pConf = this.providers[provider];
            if (pConf && pConf.requiresApiKey) {
                var apiKey = this.getApiKey(provider);
                if (!apiKey) {
                    onResult(false, pConf.name + ': API key required');
                } else {
                    onResult(true, pConf.name + ': API key configured');
                }
            } else {
                onResult(true, 'Provider ready');
            }
        }
    }
};

// ===================================================================
// Mount: create an AI panel instance
// ===================================================================
FontRig.AiAgentPanel.mount = function(containerEl, ctx, onReady) {
    if (!containerEl) return null;

    var inst = {
        _containerEl: containerEl,
        _chatEl: null,
        _inputEl: null,
        _sendBtnEl: null,
        _statusEl: null,
        _settingsEl: null,
        _modelSelectEl: null,
        _providerSelectEl: null,
        _messages: [],
        _streaming: false,
        _abortController: null,
    };

    containerEl.innerHTML = '';
    containerEl.className = 'ai-panel';

    FontRig.AiAgentBridge.loadConfig(function() {
        _buildUI(inst);
        inst.appendMessage = function(role, content) { _appendMessage(inst, role, content); };
        inst.setStatus = function(status, text) { _setStatus(inst, status, text); };
        inst.focus = function() {
            if (inst._inputEl) setTimeout(function() { inst._inputEl.focus(); }, 50);
        };
        inst.clearChat = function() { _clearChat(inst); };
        inst.executeCode = function(code) { _executeCode(inst, code); };
        inst.onMainWindowEvent = function(eventType) {};
        if (onReady) onReady(inst);
    });

    return inst;
};

// ===================================================================
// Internal: Build UI
// ===================================================================
function _buildUI(inst) {
    var container = inst._containerEl;

    // Header with provider/model selector
    var header = document.createElement('div');
    header.className = 'ai-panel__header';

    var providerSelect = document.createElement('select');
    providerSelect.className = 'ai-select';
    var providerKeys = Object.keys(FontRig.AiAgentBridge.providers);
    for (var p = 0; p < providerKeys.length; p++) {
        var pkey = providerKeys[p];
        var pdata = FontRig.AiAgentBridge.providers[pkey];
        var opt = document.createElement('option');
        opt.value = pkey;
        opt.textContent = pdata.name;
        providerSelect.appendChild(opt);
    }
    providerSelect.value = FontRig.AiAgentBridge.currentProvider;
    header.appendChild(providerSelect);
    inst._providerSelectEl = providerSelect;

    var modelSelect = document.createElement('select');
    modelSelect.className = 'ai-select';
    header.appendChild(modelSelect);
    inst._modelSelectEl = modelSelect;

    var settingsBtn = document.createElement('button');
    settingsBtn.className = 'ai-btn ai-btn--icon';
    settingsBtn.innerHTML = '<span class="tri">view_list</span>';
    settingsBtn.title = 'AI Settings';
    header.appendChild(settingsBtn);
    inst._settingsBtnEl = settingsBtn;

    container.appendChild(header);

    function updateModelSelect() {
        var provider = providerSelect.value;
        var pdata = FontRig.AiAgentBridge.providers[provider];
        if (!pdata) return;
        var models = pdata.models || [];
        modelSelect.innerHTML = '';
        for (var i = 0; i < models.length; i++) {
            var opt = document.createElement('option');
            opt.value = models[i].id;
            opt.textContent = models[i].name + (models[i].size ? ' (' + models[i].size + ')' : '');
            modelSelect.appendChild(opt);
        }
        if (modelSelect.value !== FontRig.AiAgentBridge.currentModel) {
            modelSelect.value = models.length > 0 ? models[0].id : '';
        }
    }
    updateModelSelect();

    if (modelSelect.value !== FontRig.AiAgentBridge.currentModel) {
        FontRig.AiAgentBridge.currentModel = modelSelect.value;
    }

    // Model change handler
    providerSelect.addEventListener('change', function() {
        FontRig.AiAgentBridge.currentProvider = providerSelect.value;
        updateModelSelect();
        FontRig.AiAgentBridge.checkStatus(providerSelect.value, function(ok, text) {
            _setStatus(inst, ok ? 'ready' : 'error', text);
        });
    });

    modelSelect.addEventListener('change', function() {
        FontRig.AiAgentBridge.currentModel = modelSelect.value;
    });

    // Settings panel (hidden by default)
    var settingsPanel = document.createElement('div');
    settingsPanel.className = 'ai-panel__settings';
    settingsPanel.style.display = 'none';

    settingsPanel.innerHTML = '<div class="ai-settings-title">Settings</div>';

    // Dynamically build provider settings from config
    var _providerInputs = {};
    var providerKeys = Object.keys(FontRig.AiAgentBridge.providers);
    for (var pi = 0; pi < providerKeys.length; pi++) {
        var pkey = providerKeys[pi];
        var pconf = FontRig.AiAgentBridge.providers[pkey];
        _providerInputs[pkey] = {};

        // Provider section title
        var pTitle = document.createElement('div');
        pTitle.style.cssText = 'font-size:11px;font-weight:600;color:var(--text-secondary);margin:8px 0 4px;';
        pTitle.textContent = pconf.name;
        settingsPanel.appendChild(pTitle);

        // Base URL field (if provider requires it)
        if (pconf.requiresBaseUrl) {
            var urlGroup = document.createElement('div');
            urlGroup.className = 'ai-settings-group';
            urlGroup.innerHTML = '<label>' + pconf.name + ' URL</label>';
            var urlInput = document.createElement('input');
            urlInput.type = 'text';
            urlInput.className = 'ai-input';
            urlInput.value = FontRig.AiAgentBridge.getBaseUrl(pkey) || pconf.baseUrl || '';
            urlInput.placeholder = pconf.baseUrl || 'Enter URL';
            urlGroup.appendChild(urlInput);
            settingsPanel.appendChild(urlGroup);
            _providerInputs[pkey].urlInput = urlInput;
        }

        // API Key field (if provider requires it)
        if (pconf.requiresApiKey) {
            var keyGroup = document.createElement('div');
            keyGroup.className = 'ai-settings-group';
            keyGroup.innerHTML = '<label>' + pconf.name + ' API Key</label>';
            var keyInput = document.createElement('input');
            keyInput.type = 'password';
            keyInput.className = 'ai-input';
            keyInput.value = FontRig.AiAgentBridge.getApiKey(pkey) || '';
            keyInput.placeholder = 'Enter API key';
            keyGroup.appendChild(keyInput);
            settingsPanel.appendChild(keyGroup);
            _providerInputs[pkey].keyInput = keyInput;
        }

        // CORS Proxy field (if provider uses one)
        if (pconf.corsProxy !== undefined && pconf.corsProxy !== '') {
            var corsGroup = document.createElement('div');
            corsGroup.className = 'ai-settings-group';
            corsGroup.innerHTML = '<label>CORS Proxy (leave empty to disable)</label>';
            var corsInput = document.createElement('input');
            corsInput.type = 'text';
            corsInput.className = 'ai-input';
            corsInput.value = sessionStorage.getItem('ai-cors-proxy-' + pkey) || pconf.corsProxy || '';
            corsInput.placeholder = pconf.corsProxy || 'https://proxy.example.com/';
            corsGroup.appendChild(corsInput);
            settingsPanel.appendChild(corsGroup);
            _providerInputs[pkey].corsInput = corsInput;

            if (pconf.corsProxyNote) {
                var corsNote = document.createElement('div');
                corsNote.style.cssText = 'font-size:10px;color:#888;margin-bottom:6px;';
                corsNote.textContent = pconf.corsProxyNote;
                settingsPanel.appendChild(corsNote);
            }
        }
    }

    // Auto-execute toggle
    var autoExecGroup = document.createElement('div');
    autoExecGroup.className = 'ai-settings-group';
    autoExecGroup.innerHTML = '<label>Auto-execute code</label>';
    var autoExecCheckbox = document.createElement('input');
    autoExecCheckbox.type = 'checkbox';
    autoExecCheckbox.checked = FontRig.AiAgentBridge.getAutoExecute().enabled;
    autoExecGroup.appendChild(autoExecCheckbox);
    settingsPanel.appendChild(autoExecGroup);

    var autoExecNote = document.createElement('div');
    autoExecNote.style.cssText = 'font-size:11px;color:#888;margin-bottom:10px;';
    autoExecNote.textContent = 'AI will auto-execute code when you add <!--EXECUTE--> after code blocks.';
    settingsPanel.appendChild(autoExecNote);

    // Self-correct toggle
    var selfCorrectGroup = document.createElement('div');
    selfCorrectGroup.className = 'ai-settings-group';
    selfCorrectGroup.innerHTML = '<label>Auto self-correct</label>';
    var selfCorrectCheckbox = document.createElement('input');
    selfCorrectCheckbox.type = 'checkbox';
    selfCorrectCheckbox.checked = FontRig.AiAgentBridge.getAutoExecute().selfCorrect;
    selfCorrectGroup.appendChild(selfCorrectCheckbox);
    settingsPanel.appendChild(selfCorrectGroup);

    var selfCorrectNote = document.createElement('div');
    selfCorrectNote.style.cssText = 'font-size:11px;color:#888;margin-bottom:10px;';
    selfCorrectNote.textContent = 'AI will attempt to fix code errors automatically.';
    settingsPanel.appendChild(selfCorrectNote);

    // Max iterations
    var maxIterGroup = document.createElement('div');
    maxIterGroup.className = 'ai-settings-group';
    maxIterGroup.innerHTML = '<label>Max corrections</label>';
    var maxIterInput = document.createElement('input');
    maxIterInput.type = 'number';
    maxIterInput.min = 1;
    maxIterInput.max = 5;
    maxIterInput.value = FontRig.AiAgentBridge.getAutoExecute().maxIterations || 3;
    maxIterInput.style.cssText = 'width:50px;';
    maxIterGroup.appendChild(maxIterInput);
    settingsPanel.appendChild(maxIterGroup);

    // Save button
    var saveBtn = document.createElement('button');
    saveBtn.className = 'ai-btn ai-btn--primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function() {
        // Save all dynamic provider settings
        var pkeys = Object.keys(_providerInputs);
        for (var si = 0; si < pkeys.length; si++) {
            var sk = pkeys[si];
            var inputs = _providerInputs[sk];
            if (inputs.urlInput) {
                FontRig.AiAgentBridge.setBaseUrl(sk, inputs.urlInput.value);
            }
            if (inputs.keyInput) {
                FontRig.AiAgentBridge.setApiKey(sk, inputs.keyInput.value);
            }
            if (inputs.corsInput) {
                var corsVal = inputs.corsInput.value.trim();
                if (corsVal) {
                    sessionStorage.setItem('ai-cors-proxy-' + sk, corsVal);
                } else {
                    sessionStorage.removeItem('ai-cors-proxy-' + sk);
                }
            }
        }
        FontRig.AiAgentBridge.autoExecute.enabled = autoExecCheckbox.checked;
        FontRig.AiAgentBridge.autoExecute.selfCorrect = selfCorrectCheckbox.checked;
        FontRig.AiAgentBridge.autoExecute.maxIterations = parseInt(maxIterInput.value) || 3;
        settingsPanel.style.display = 'none';
        FontRig.AiAgentBridge.checkStatus(providerSelect.value, function(ok, text) {
            _setStatus(inst, ok ? 'ready' : 'error', text);
        });
    });
    settingsPanel.appendChild(saveBtn);

    container.appendChild(settingsPanel);
    inst._settingsEl = settingsPanel;

    settingsBtn.addEventListener('click', function() {
        settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
    });

    // Chat area
    var chat = document.createElement('div');
    chat.className = 'ai-panel__chat';
    container.appendChild(chat);
    inst._chatEl = chat;

    // Welcome message
    var welcome = document.createElement('div');
    welcome.className = 'ai-message ai-message--system';
    welcome.innerHTML = '<div class="ai-message__role">FontRig AI</div>' +
        '<div class="ai-message__content">Hello! I\'m your AI assistant for font design. ' +
        'I can help with TypeRig Python scripts, geometry questions, and glyph editing.<br><br>' +
        'Current context: ' +
        (FontRig.state.glyphData ? '<strong>' + FontRig.state.glyphData.name + '</strong>' : 'No glyph loaded') + '<br>' +
        'Python status: ' + (FontRig.pyBridge && FontRig.pyBridge.ready ? '<span class="ai-status--ready">Ready</span>' : '<span class="ai-status--idle">Not loaded</span>') + '<br><br>' +
        '<em>Shift+Enter to send, include glyph context automatically.</em></div>';
    chat.appendChild(welcome);

    // Input area
    var inputWrap = document.createElement('div');
    inputWrap.className = 'ai-panel__input-wrap';

    var input = document.createElement('textarea');
    input.className = 'ai-panel__input';
    input.rows = 1;
    input.spellcheck = false;
    input.placeholder = 'Ask about TypeRig, Python, font geometry...';
    inputWrap.appendChild(input);
    inst._inputEl = input;

    var actionsRow = document.createElement('div');
    actionsRow.className = 'ai-panel__actions';

    var sendBtn = document.createElement('button');
    sendBtn.className = 'ai-btn ai-btn--primary';
    sendBtn.textContent = 'Send';
    actionsRow.appendChild(sendBtn);
    inst._sendBtnEl = sendBtn;

    var clearBtn = document.createElement('button');
    clearBtn.className = 'ai-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', function() {
        _clearChat(inst);
    });
    actionsRow.appendChild(clearBtn);

    var execBtn = document.createElement('button');
    execBtn.className = 'ai-btn';
    execBtn.textContent = 'Exec Code';
    execBtn.title = 'Execute last code block';
    execBtn.addEventListener('click', function() {
        var lastCode = inst._lastCodeBlock;
        if (lastCode) {
            _executeCode(inst, lastCode);
        }
    });
    actionsRow.appendChild(execBtn);
    inst._execBtnEl = execBtn;

    inputWrap.appendChild(actionsRow);
    container.appendChild(inputWrap);

    // Status bar
    var statusBar = document.createElement('div');
    statusBar.className = 'ai-panel__statusbar';

    var status = document.createElement('span');
    status.className = 'ai-status ai-status--idle';
    status.textContent = 'Ready';
    statusBar.appendChild(status);
    inst._statusEl = status;

    container.appendChild(statusBar);

    // Check initial status
    FontRig.AiAgentBridge.checkStatus(FontRig.AiAgentBridge.currentProvider, function(ok, text) {
        _setStatus(inst, ok ? 'ready' : 'error', text);
    });

    // Wire events
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            _sendMessage(inst);
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            // Allow newlines with just Enter, but send on Shift+Enter
        }
    });

    input.addEventListener('input', function() {
        _autoResize(input);
    });

    sendBtn.addEventListener('click', function() {
        _sendMessage(inst);
    });
}

function _autoResize(textarea) {
    textarea.style.height = 'auto';
    var maxH = 120;
    textarea.style.height = Math.min(textarea.scrollHeight, maxH) + 'px';
}

function _appendMessage(inst, role, content) {
    var chat = inst._chatEl;
    if (!chat) return;

    var msg = document.createElement('div');
    msg.className = 'ai-message ai-message--' + role;

    var roleLabel = role === 'user' ? 'You' : (role === 'assistant' ? 'AI' : (role === 'error' ? 'Error' : 'System'));
    var roleIcon = role === 'user' ? 'help' : (role === 'assistant' ? 'node_target' : (role === 'error' ? 'warning' : 'info'));

    msg.innerHTML = '<div class="ai-message__header"><span class="tri">' + roleIcon + '</span><span>' + roleLabel + '</span></div>' +
        '<div class="ai-message__content">' + _formatContent(content) + '</div>';

    // Add copy button for assistant and error messages
    if (role === 'assistant' || role === 'error' || role === 'system') {
        var actions = document.createElement('div');
        actions.className = 'ai-message__actions';
        var copyBtn = document.createElement('button');
        copyBtn.className = 'ai-copy-btn';
        copyBtn.innerHTML = '<span class="tri">content_copy</span> Copy';
        copyBtn.addEventListener('click', function() {
            // Get plain text content (strip HTML)
            var textContent = msg.querySelector('.ai-message__content').innerText || content;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textContent).then(function() {
                    copyBtn.innerHTML = '<span class="tri">check</span> Copied';
                    setTimeout(function() {
                        copyBtn.innerHTML = '<span class="tri">content_copy</span> Copy';
                    }, 1500);
                }).catch(function() {
                    _fallbackCopy(textContent, copyBtn);
                });
            } else {
                _fallbackCopy(textContent, copyBtn);
            }
        });
        actions.appendChild(copyBtn);
        msg.appendChild(actions);
    }

    chat.appendChild(msg);
    chat.scrollTop = chat.scrollHeight;

    // Extract code blocks for execution
    if (role === 'assistant') {
        var codeMatch = content.match(/```python\n([\s\S]*?)```/);
        if (codeMatch) {
            inst._lastCodeBlock = codeMatch[1].trim();
        } else {
            var codeMatch2 = content.match(/```\n([\s\S]*?)```/);
            if (codeMatch2) {
                inst._lastCodeBlock = codeMatch2[1].trim();
            }
        }
    }
}

function _fallbackCopy(text, btn) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        btn.innerHTML = '<span class="tri">check</span> Copied';
        setTimeout(function() {
            btn.innerHTML = '<span class="tri">content_copy</span> Copy';
        }, 1500);
    } catch (e) { /* silent fail */ }
    document.body.removeChild(textarea);
}

function _formatContent(content) {
    // Escape HTML
    var escaped = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Format code blocks
    escaped = escaped.replace(/```python\n([\s\S]*?)```/g, '<pre class="ai-code"><code>$1</code></pre>');
    escaped = escaped.replace(/```\n([\s\S]*?)```/g, '<pre class="ai-code"><code>$1</code></pre>');

    // Format inline code
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');

    // Format bold
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Format newlines
    escaped = escaped.replace(/\n/g, '<br>');

    return escaped;
}

function _setStatus(inst, status, text) {
    var el = inst._statusEl;
    if (!el) return;
    el.textContent = text || '';
    el.className = 'ai-status ai-status--' + status;
}

function _clearChat(inst) {
    var chat = inst._chatEl;
    if (!chat) return;
    chat.innerHTML = '';

    var welcome = document.createElement('div');
    welcome.className = 'ai-message ai-message--system';
    welcome.innerHTML = '<div class="ai-message__role">FontRig AI</div>' +
        '<div class="ai-message__content">Chat cleared. Ask me anything about font design!</div>';
    chat.appendChild(welcome);

    inst._messages = [];
    inst._lastCodeBlock = null;
}

function _sendMessage(inst) {
    var input = inst._inputEl;
    var sendBtn = inst._sendBtnEl;

    var text = input.value.trim();
    if (!text || inst._streaming) return;

    // Add user message
    inst._messages.push({ role: 'user', content: text });
    _appendMessage(inst, 'user', text);

    // Clear input
    input.value = '';
    _autoResize(input);

    // Show thinking
    inst._streaming = true;
    sendBtn.disabled = true;
    var thinkingEl = document.createElement('div');
    thinkingEl.className = 'ai-message ai-message--thinking';
    thinkingEl.innerHTML = '<div class="ai-message__header"><span class="tri">node_target</span><span>AI</span></div>' +
        '<div class="ai-message__content ai-thinking"><span class="ai-dots">...</span></div>';
    inst._chatEl.appendChild(thinkingEl);
    inst._chatEl.scrollTop = inst._chatEl.scrollHeight;

    _setStatus(inst, 'loading', 'Thinking...');

    var fullResponse = '';

    FontRig.AiAgentBridge.sendMessage(
        inst._messages,
        // onChunk
        function(chunk) {
            fullResponse += chunk;
            var content = thinkingEl.querySelector('.ai-message__content');
            if (content) {
                content.innerHTML = _formatContent(fullResponse);
            }
            inst._chatEl.scrollTop = inst._chatEl.scrollHeight;
        },
        // onComplete
        function(finalResponse) {
            inst._streaming = false;
            sendBtn.disabled = false;

            // Remove thinking, add response
            thinkingEl.remove();
            inst._messages.push({ role: 'assistant', content: finalResponse });
            _appendMessage(inst, 'assistant', finalResponse);

    // Check for auto-execute trigger
            var autoConfig = FontRig.AiAgentBridge.getAutoExecute();
            if (autoConfig.enabled && finalResponse.indexOf(autoConfig.trigger) !== -1) {
                var codeBlocks = _extractCodeBlocks(finalResponse);
                if (codeBlocks.length > 0) {
                    _appendMessage(inst, 'system', 'Auto-executing ' + codeBlocks.length + ' code block(s)...');
                    inst._streaming = true;
                    sendBtn.disabled = true;
                    _autoExecuteChain(inst, codeBlocks, 0, [], autoConfig.maxIterations || 3, function(allResults) {
                        inst._streaming = false;
                        sendBtn.disabled = false;
                        
                        var hasErrors = allResults.some(function(r) { return r.error; });
                        
                        if (hasErrors) {
                            var errorCount = allResults.filter(function(r) { return r.error; }).length;
                            _appendMessage(inst, 'system', '--- Execution completed with ' + errorCount + ' error(s) ---');
                            
                            if (autoConfig.selfCorrect) {
                                _appendMessage(inst, 'system', 'Attempting self-correction...');
                                _selfCorrect(inst, allResults, autoConfig.maxIterations || 3, 1, function(corrected) {
                                    inst._streaming = false;
                                    sendBtn.disabled = false;
                                    _setStatus(inst, 'ready', 'Ready');
                                });
                            } else {
                                _appendMessage(inst, 'system', 'Self-correction disabled. Review errors above and try again manually.');
                                _setStatus(inst, 'ready', 'Ready');
                            }
                        } else {
                            _appendMessage(inst, 'system', '--- All code executed successfully! ---');
                            _setStatus(inst, 'ready', 'Ready');
                        }
                    });
                } else {
                    _setStatus(inst, 'ready', 'Ready');
                }
            } else {
                _setStatus(inst, 'ready', 'Ready');
            }
        },
        // onError
        function(error) {
            inst._streaming = false;
            sendBtn.disabled = false;
            thinkingEl.remove();

            _appendMessage(inst, 'error', 'Error: ' + error);
            _setStatus(inst, 'error', 'Error: ' + error);
        }
    );
}

function _extractCodeBlocks(text) {
    var blocks = [];
    var codeBlockRegex = /```python\n([\s\S]*?)```/g;
    var match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
        var code = match[1].trim();
        if (code) blocks.push(code);
    }
    return blocks;
}

function _autoExecuteChain(inst, blocks, index, results, maxIterations, onComplete) {
    if (index >= blocks.length) {
        if (onComplete) onComplete(results);
        return;
    }

    var code = blocks[index];
    _appendMessage(inst, 'system', '--- Executing block ' + (index + 1) + '/' + blocks.length + ' ---\n```python\n' + code + '\n```');

    var blockResult = { index: index, code: code, output: '', error: null, success: false };

    if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
        _appendMessage(inst, 'system', 'Python runtime not ready. Initialize Python panel first.');
        blockResult.error = 'Python runtime not ready';
        results.push(blockResult);
        if (onComplete) onComplete(results);
        return;
    }

    var result = FontRig.pyBridge.run(code);

    if (result.error) {
        blockResult.error = result.error;
        _appendErrorDetail(inst, 'Execution error in block ' + (index + 1), code, result.error);
    } else {
        blockResult.success = true;
        if (result.output) {
            blockResult.output = result.output;
            _appendMessage(inst, 'system', result.output);
        }
        if (result.glyphChanged) {
            _appendMessage(inst, 'system', 'Glyph updated.');
        }
    }

    results.push(blockResult);
    inst._chatEl.scrollTop = inst._chatEl.scrollHeight;

    setTimeout(function() {
        _autoExecuteChain(inst, blocks, index + 1, results, maxIterations, onComplete);
    }, 100);
}

function _appendErrorDetail(inst, title, code, error) {
    var chat = inst._chatEl;
    if (!chat) return;

    var msg = document.createElement('div');
    msg.className = 'ai-message ai-message--error';

    msg.innerHTML = '<div class="ai-message__header"><span class="tri">warning</span><span>' + title + '</span></div>' +
        '<div class="ai-message__content">' +
        (code ? '<pre class="ai-code"><code>' + code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>' : '') +
        '<div class="ai-error-detail">' + String(error).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>' +
        '</div>';

    // Copy button for error
    var actions = document.createElement('div');
    actions.className = 'ai-message__actions';
    var copyBtn = document.createElement('button');
    copyBtn.className = 'ai-copy-btn';
    copyBtn.innerHTML = '<span class="tri">content_copy</span> Copy error';
    copyBtn.addEventListener('click', function() {
        var textContent = 'Error: ' + error + (code ? '\n\nCode:\n' + code : '');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textContent).then(function() {
                copyBtn.innerHTML = '<span class="tri">check</span> Copied';
                setTimeout(function() { copyBtn.innerHTML = '<span class="tri">content_copy</span> Copy error'; }, 1500);
            }).catch(function() { _fallbackCopy(textContent, copyBtn); });
        } else {
            _fallbackCopy(textContent, copyBtn);
        }
    });
    actions.appendChild(copyBtn);
    msg.appendChild(actions);

    chat.appendChild(msg);
    chat.scrollTop = chat.scrollHeight;
}

function _selfCorrect(inst, results, maxIterations, currentIteration, onComplete) {
    if (currentIteration > maxIterations) {
        _appendMessage(inst, 'system', 'Max iterations reached. Could not auto-correct errors.');
        if (onComplete) onComplete();
        return;
    }

    var errors = results.filter(function(r) { return r.error; });
    if (errors.length === 0) {
        _appendMessage(inst, 'system', 'All code executed successfully!');
        if (onComplete) onComplete();
        return;
    }

    _appendMessage(inst, 'system', '--- Self-correction attempt ' + currentIteration + '/' + maxIterations + ' ---');

    // Show each error clearly to the user before sending to AI
    for (var ei = 0; ei < errors.length; ei++) {
        _appendErrorDetail(inst, 'Error sent to AI (block ' + (errors[ei].index + 1) + ')', errors[ei].code, errors[ei].error);
    }

    var errorSummary = errors.map(function(e, i) {
        return 'Block ' + (e.index + 1) + ' error:\n```python\n' + e.code + '\n```\nError: ' + e.error;
    }).join('\n\n');

    var correctionPrompt = 
        'I need you to fix Python code that produced errors. Here are the errors:\n\n' +
        errorSummary + '\n\n' +
        'Context about the current glyph state:\n' + FontRig.AiAgentBridge.buildContext() + '\n\n' +
        'TypeRig API Reference (use these methods only):\n' + (FontRig.AiAgentBridge._apiReference || 'No API reference loaded') + '\n\n' +
        'Please provide corrected code that fixes these errors. If the original approach won\'t work, suggest an alternative. ' +
        'Include <!--EXECUTE--> after the code if you want it to run again.';

    inst._streaming = true;
    
    var thinkingEl = document.createElement('div');
    thinkingEl.className = 'ai-message ai-message--thinking';
    thinkingEl.innerHTML = '<div class="ai-message__header"><span class="tri">auto_fix_high</span><span>Self-correcting...</span></div>' +
        '<div class="ai-message__content ai-thinking"><span class="ai-dots">...</span></div>';
    inst._chatEl.appendChild(thinkingEl);
    inst._chatEl.scrollTop = inst._chatEl.scrollHeight;

    var fullResponse = '';
    FontRig.AiAgentBridge.sendMessage(
        [{ role: 'user', content: correctionPrompt }],
        function(chunk) {
            fullResponse += chunk;
            var content = thinkingEl.querySelector('.ai-message__content');
            if (content) content.innerHTML = _formatContent(fullResponse);
            inst._chatEl.scrollTop = inst._chatEl.scrollHeight;
        },
        function(finalResponse) {
            thinkingEl.remove();
            inst._messages.push({ role: 'assistant', content: finalResponse });
            _appendMessage(inst, 'assistant', finalResponse);

            var autoConfig = FontRig.AiAgentBridge.getAutoExecute();
            if (autoConfig.trigger && finalResponse.indexOf(autoConfig.trigger) !== -1) {
                var newBlocks = _extractCodeBlocks(finalResponse);
                if (newBlocks.length > 0) {
                    _appendMessage(inst, 'system', 'Retrying with corrected code...');
                    var newResults = [];
                    _autoExecuteChain(inst, newBlocks, 0, newResults, maxIterations, function(allResults) {
                        var stillHasErrors = allResults.some(function(r) { return r.error; });
                        if (stillHasErrors) {
                            setTimeout(function() {
                                _selfCorrect(inst, allResults, maxIterations, currentIteration + 1, onComplete);
                            }, 500);
                        } else {
                            _appendMessage(inst, 'system', 'Self-correction successful!');
                            if (onComplete) onComplete();
                        }
                    });
                    return;
                }
            }
            _appendMessage(inst, 'system', 'No executable code found in correction. Manual review needed.');
            if (onComplete) onComplete();
        },
        function(error) {
            thinkingEl.remove();
            _appendMessage(inst, 'error', 'Self-correction failed: ' + error);
            if (onComplete) onComplete();
        }
    );
}

function _executeCode(inst, code) {
    if (!code) return;

    _appendMessage(inst, 'system', 'Executing code via TypeRig...\n```python\n' + code + '\n```');

    if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
        _appendMessage(inst, 'system', 'Python runtime not ready. Click Init in Python panel first.');
        return;
    }

    var result = FontRig.pyBridge.run(code);

    if (result.output) {
        _appendMessage(inst, 'system', result.output);
    }
    if (result.error) {
        _appendMessage(inst, 'error', 'Error: ' + result.error);
    }
    if (result.glyphChanged) {
        _appendMessage(inst, 'system', 'Glyph updated in viewer.');
    }
}

// ===================================================================
// Legacy global API
// ===================================================================
FontRig.aiPanel = {
    appendMessage: function(role, content) {
        var SBC = FontRig.SidebarConfig;
        if (SBC) {
            SBC.forEachInstance('ai-agent', function(inst) {
                if (inst && inst.appendMessage) inst.appendMessage(role, content);
            });
        }
    },

    clearChat: function() {
        var SBC = FontRig.SidebarConfig;
        if (SBC) {
            SBC.forEachInstance('ai-agent', function(inst) {
                if (inst && inst.clearChat) inst.clearChat();
            });
        }
    }
};
