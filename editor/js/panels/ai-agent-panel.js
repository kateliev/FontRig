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

    providers: {
        ollama: {
            name: 'Ollama (Local)',
            defaultModel: 'qwen2.5-coder',
            baseUrl: 'http://localhost:11434',
            requiresKey: false,
            models: [
                { id: 'qwen2.5-coder', name: 'Qwen Coder' },
                { id: 'codellama:13b', name: 'Code Llama 13B' },
                { id: 'llama3.2', name: 'Llama 3.2' },
                { id: 'mistral', name: 'Mistral' },
            ]
        },
        gemini: {
            name: 'Google Gemini (Cloud)',
            defaultModel: 'gemini-2.0-flash',
            requiresKey: true,
            models: [
                { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Fast)' },
                { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
                { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Smart)' },
            ]
        }
    },

    currentProvider: 'gemini',
    currentModel: 'gemini-2.0-flash',

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

    // Send message to AI provider
    sendMessage: function(messages, onChunk, onComplete, onError) {
        var provider = this.currentProvider;
        var model = this.currentModel;

        if (provider === 'ollama') {
            this._sendOllama(messages, onChunk, onComplete, onError);
        } else if (provider === 'gemini') {
            this._sendGemini(messages, onChunk, onComplete, onError);
        } else {
            onError('Unknown provider: ' + provider);
        }
    },

    // Ollama API
    _sendOllama: function(messages, onChunk, onComplete, onError) {
        var baseUrl = this.getBaseUrl('ollama') || this.providers.ollama.baseUrl;
        var model = this.currentModel;

        var systemPrompt = 'You are an expert in font design, TypeRig, and Python scripting for font editing. ' +
            'The user is working in FontRig, a browser-based font editor that uses TypeRig Python library. ' +
            'Help them with font editing tasks, Python scripts, geometry questions, and TypeRig API usage. ' +
            'When providing code, use Python syntax compatible with TypeRig core objects.';

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

        fetch(baseUrl + '/api/chat', {
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

    // Gemini API
    _sendGemini: function(messages, onChunk, onComplete, onError) {
        var apiKey = this.getApiKey('gemini');
        if (!apiKey) {
            onError('Gemini API key required. Enter it in settings.');
            return;
        }

        var model = this.currentModel;
        var baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':streamGenerateContent?key=' + apiKey + '&alt=sse';

        var systemInstruction = 'You are an expert in font design, TypeRig, and Python scripting for font editing. ' +
            'The user is working in FontRig, a browser-based font editor that uses TypeRig Python library. ' +
            'Help them with font editing tasks, Python scripts, geometry questions, and TypeRig API usage. ' +
            'When providing code, use Python syntax compatible with TypeRig core objects. ' +
            'Format code blocks with ```python. Be concise and helpful.';

        var contents = messages.map(function(m) {
            return {
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            };
        });

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

        // Add context as first user message if this is the first exchange
        if (messages.length === 1 && messages[0].role === 'user') {
            messages[0].content = this.buildContext() + '\n\n' + messages[0].content;
        }

        fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function(response) {
            if (!response.ok) {
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
                        if (lines[i].trim() && lines[i].startsWith('data:')) {
                            try {
                                var data = JSON.parse(lines[i].substring(5));
                                if (data.candidates && data.candidates[0]) {
                                    var parts = data.candidates[0].content.parts;
                                    for (var j = 0; j < parts.length; j++) {
                                        if (parts[j].text) {
                                            fullResponse += parts[j].text;
                                            onChunk(parts[j].text);
                                        }
                                    }
                                }
                            } catch (e) { /* skip invalid JSON */ }
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
            var baseUrl = this.getBaseUrl('ollama') || this.providers.ollama.baseUrl;
            fetch(baseUrl + '/api/tags', { method: 'GET' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    onResult(true, 'Ollama ready - ' + (data.models ? data.models.length : 0) + ' models');
                })
                .catch(function(e) {
                    onResult(false, 'Ollama not available: ' + e.message);
                });
        } else if (provider === 'gemini') {
            var apiKey = this.getApiKey('gemini');
            if (!apiKey) {
                onResult(false, 'API key required');
            } else {
                onResult(true, 'API key configured');
            }
        }
    }
};

// ===================================================================
// Mount: create an AI panel instance
// ===================================================================
FontRig.AiAgentPanel.mount = function(containerEl, ctx) {
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

    // Build UI
    _buildUI(inst);

    // Attach public methods
    inst.appendMessage = function(role, content) { _appendMessage(inst, role, content); };
    inst.setStatus = function(status, text) { _setStatus(inst, status, text); };
    inst.focus = function() {
        if (inst._inputEl) setTimeout(function() { inst._inputEl.focus(); }, 50);
    };
    inst.clearChat = function() { _clearChat(inst); };
    inst.executeCode = function(code) { _executeCode(inst, code); };
    inst.onMainWindowEvent = function(eventType) {};

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
    providerSelect.innerHTML = '<option value="ollama">Ollama (Local)</option><option value="gemini" selected>Gemini (Cloud)</option>';
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

    // Update model select based on provider
    function updateModelSelect() {
        var provider = providerSelect.value;
        var models = FontRig.AiAgentBridge.providers[provider].models;
        modelSelect.innerHTML = '';
        for (var i = 0; i < models.length; i++) {
            var opt = document.createElement('option');
            opt.value = models[i].id;
            opt.textContent = models[i].name;
            modelSelect.appendChild(opt);
        }
        modelSelect.value = FontRig.AiAgentBridge.currentModel;
    }
    updateModelSelect();

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

    // Ollama URL
    var ollamaUrlGroup = document.createElement('div');
    ollamaUrlGroup.className = 'ai-settings-group';
    ollamaUrlGroup.innerHTML = '<label>Ollama URL</label>';
    var ollamaUrlInput = document.createElement('input');
    ollamaUrlInput.type = 'text';
    ollamaUrlInput.className = 'ai-input';
    ollamaUrlInput.value = FontRig.AiAgentBridge.getBaseUrl('ollama') || 'http://localhost:11434';
    ollamaUrlInput.placeholder = 'http://localhost:11434';
    ollamaUrlGroup.appendChild(ollamaUrlInput);
    settingsPanel.appendChild(ollamaUrlGroup);

    // Gemini API Key
    var geminiKeyGroup = document.createElement('div');
    geminiKeyGroup.className = 'ai-settings-group';
    geminiKeyGroup.innerHTML = '<label>Gemini API Key</label>';
    var geminiKeyInput = document.createElement('input');
    geminiKeyInput.type = 'text';
    geminiKeyInput.className = 'ai-input';
    geminiKeyInput.value = FontRig.AiAgentBridge.getApiKey('gemini') || '';
    geminiKeyInput.placeholder = 'Enter API key';
    geminiKeyGroup.appendChild(geminiKeyInput);
    settingsPanel.appendChild(geminiKeyGroup);

    // Save button
    var saveBtn = document.createElement('button');
    saveBtn.className = 'ai-btn ai-btn--primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function() {
        FontRig.AiAgentBridge.setBaseUrl('ollama', ollamaUrlInput.value);
        FontRig.AiAgentBridge.setApiKey('gemini', geminiKeyInput.value);
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

    var roleLabel = role === 'user' ? 'You' : (role === 'assistant' ? 'AI' : 'System');
    var roleIcon = role === 'user' ? 'help' : (role === 'assistant' ? 'node_target' : 'info');

    msg.innerHTML = '<div class="ai-message__header"><span class="tri">' + roleIcon + '</span><span>' + roleLabel + '</span></div>' +
        '<div class="ai-message__content">' + _formatContent(content) + '</div>';

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

            _setStatus(inst, 'ready', 'Ready');
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
