// ===================================================================
// TypeRig Widgets (FRWidget) — Reusable UI Gadget Library
// ===================================================================
// Qt-style widget factories for dark-themed web UIs.
// All widgets return plain DOM elements; no framework dependency.
//
// Icon system: Uses TypeRig Icons ligature font via the 'tri' class.
// FRWidget.icon(name) creates <span class="tri">name</span>.
// ===================================================================
'use strict';

var FRWidget = FRWidget || {};

// ===================================================================
// ICON SYSTEM — TypeRig Icons ligature font
// ===================================================================
FRWidget.icon = function(name) {
	if (!name) return null;
	var span = document.createElement('span');
	span.className = 'tri';
	span.textContent = name;
	return span;
};

// ===================================================================
// LABEL
// ===================================================================
FRWidget.Label = function(text, opts) {
	opts = opts || {};
	var el = document.createElement('span');
	el.className = 'frw-label';
	el.textContent = text;

	if (opts.heading) el.classList.add('frw-label--heading');
	if (opts.mono)    el.classList.add('frw-label--mono');
	if (opts.dim)     el.classList.add('frw-label--dim');
	if (opts.tooltip) el.title = opts.tooltip;

	return el;
};

// ===================================================================
// BUTTON
// ===================================================================
FRWidget.Button = function(text, opts) {
	opts = opts || {};
	var el = document.createElement('button');
	el.className = 'frw-btn';
	el.type = 'button';

	if (opts.icon) {
		var ic = FRWidget.icon(opts.icon);
		if (ic) el.appendChild(ic);
	}

	if (text) {
		var span = document.createElement('span');
		span.textContent = text;
		el.appendChild(span);
	}

	if (!text && opts.icon) el.classList.add('frw-btn--icon');
	if (opts.primary)       el.classList.add('frw-btn--primary');
	if (opts.compact)       el.classList.add('frw-btn--compact');
	if (opts.tooltip)       el.title = opts.tooltip;
	if (opts.disabled)      el.disabled = true;
	if (opts.onClick)       el.addEventListener('click', opts.onClick);

	return el;
};

// ===================================================================
// TOGGLE BUTTON
// ===================================================================
FRWidget.ToggleButton = function(text, opts) {
	opts = opts || {};
	var el = FRWidget.Button(text, opts);
	el.classList.add('frw-toggle');

	if (opts.active) el.classList.add('active');
	if (opts.group)  el.setAttribute('data-group', opts.group);

	var _onChange = opts.onChange || null;

	el.addEventListener('click', function() {
		if (opts.group) {
			// Radio behavior: deactivate siblings in same group
			var parent = el.parentElement;
			if (parent) {
				var siblings = parent.querySelectorAll('.frw-toggle[data-group="' + opts.group + '"]');
				for (var i = 0; i < siblings.length; i++) {
					siblings[i].classList.remove('active');
				}
			}
			el.classList.add('active');
		} else {
			el.classList.toggle('active');
		}
		if (_onChange) _onChange(el.classList.contains('active'));
	});

	// API
	el.getValue = function() { return el.classList.contains('active'); };
	el.setValue = function(v) { el.classList.toggle('active', !!v); };

	return el;
};

// ===================================================================
// GROUP BOX (titled container with flow content area)
// ===================================================================
FRWidget.GroupBox = function(title, opts) {
	opts = opts || {};
	var box = document.createElement('div');
	box.className = 'frw-group';

	if (title) {
		var lbl = document.createElement('div');
		lbl.className = 'frw-group__label';
		lbl.textContent = title;
		box.appendChild(lbl);
	}

	var content = document.createElement('div');
	content.className = 'frw-group__content';
	box.appendChild(content);

	// API
	box.content = content;
	box.addWidget = function(widget) { content.appendChild(widget); return box; };
	box.addSeparator = function() {
		var sep = document.createElement('div');
		sep.className = 'frw-separator';
		content.appendChild(sep);
		return box;
	};

	return box;
};

// ===================================================================
// SPIN BOX (integer)
// ===================================================================
FRWidget.SpinBox = function(opts) {
	opts = opts || {};
	var min  = opts.min !== undefined ? opts.min : 0;
	var max  = opts.max !== undefined ? opts.max : 100;
	var val  = opts.value !== undefined ? opts.value : 0;
	var step = opts.step || 1;
	var _onChange = opts.onChange || null;

	var wrap = document.createElement('div');
	wrap.className = 'frw-spinbox';

	var input = document.createElement('input');
	input.className = 'frw-spinbox__input';
	input.type = 'text';
	input.value = val;

	var suffixEl = null;
	if (opts.suffix) {
		suffixEl = document.createElement('span');
		suffixEl.className = 'frw-spinbox__suffix';
		suffixEl.textContent = opts.suffix;
	}

	var btnInc = document.createElement('button');
	btnInc.className = 'frw-spinbox__btn frw-spinbox__btn--inc';
	btnInc.type = 'button';
	btnInc.textContent = '\u25B4'; // small up triangle

	var btnDec = document.createElement('button');
	btnDec.className = 'frw-spinbox__btn frw-spinbox__btn--dec';
	btnDec.type = 'button';
	btnDec.textContent = '\u25BE'; // small down triangle

	var arrows = document.createElement('div');
	arrows.className = 'frw-spinbox__arrows';
	arrows.appendChild(btnInc);
	arrows.appendChild(btnDec);

	wrap.appendChild(input);
	if (suffixEl) wrap.appendChild(suffixEl);
	wrap.appendChild(arrows);

	function clamp(v) { return Math.max(min, Math.min(max, v)); }

	function setValue(v, notify) {
		v = clamp(Math.round(v));
		input.value = v;
		if (notify !== false && _onChange) _onChange(v);
	}

	btnDec.addEventListener('click', function() { setValue(parseInt(input.value, 10) - step); });
	btnInc.addEventListener('click', function() { setValue(parseInt(input.value, 10) + step); });

	input.addEventListener('change', function() {
		var v = parseInt(input.value, 10);
		if (isNaN(v)) v = val;
		setValue(v);
	});

	input.addEventListener('keydown', function(e) {
		if (e.key === 'ArrowUp')   { e.preventDefault(); setValue(parseInt(input.value, 10) + step); }
		if (e.key === 'ArrowDown') { e.preventDefault(); setValue(parseInt(input.value, 10) - step); }
	});

	// API
	wrap.getValue = function() { return parseInt(input.value, 10); };
	wrap.setValue = function(v) { setValue(v, false); };
	wrap.setRange = function(mn, mx) { min = mn; max = mx; setValue(clamp(parseInt(input.value, 10))); };
	wrap.input = input;

	if (opts.tooltip) wrap.title = opts.tooltip;
	return wrap;
};

// ===================================================================
// DOUBLE SPIN BOX (float)
// ===================================================================
FRWidget.DoubleSpinBox = function(opts) {
	opts = opts || {};
	var min  = opts.min !== undefined ? opts.min : 0;
	var max  = opts.max !== undefined ? opts.max : 100;
	var val  = opts.value !== undefined ? opts.value : 0;
	var step = opts.step || 0.1;
	var decimals = opts.decimals !== undefined ? opts.decimals : 2;
	var _onChange = opts.onChange || null;

	var wrap = document.createElement('div');
	wrap.className = 'frw-spinbox';

	var input = document.createElement('input');
	input.className = 'frw-spinbox__input';
	input.type = 'text';
	input.value = val.toFixed(decimals);

	var suffixEl = null;
	if (opts.suffix) {
		suffixEl = document.createElement('span');
		suffixEl.className = 'frw-spinbox__suffix';
		suffixEl.textContent = opts.suffix;
	}

	var btnInc = document.createElement('button');
	btnInc.className = 'frw-spinbox__btn frw-spinbox__btn--inc';
	btnInc.type = 'button';
	btnInc.textContent = '\u25B4'; // small up triangle

	var btnDec = document.createElement('button');
	btnDec.className = 'frw-spinbox__btn frw-spinbox__btn--dec';
	btnDec.type = 'button';
	btnDec.textContent = '\u25BE'; // small down triangle

	var arrows = document.createElement('div');
	arrows.className = 'frw-spinbox__arrows';
	arrows.appendChild(btnInc);
	arrows.appendChild(btnDec);

	wrap.appendChild(input);
	if (suffixEl) wrap.appendChild(suffixEl);
	wrap.appendChild(arrows);

	function clamp(v) { return Math.max(min, Math.min(max, v)); }

	function setValue(v, notify) {
		v = clamp(parseFloat(v.toFixed(decimals)));
		input.value = v.toFixed(decimals);
		if (notify !== false && _onChange) _onChange(v);
	}

	btnDec.addEventListener('click', function() { setValue(parseFloat(input.value) - step); });
	btnInc.addEventListener('click', function() { setValue(parseFloat(input.value) + step); });

	input.addEventListener('change', function() {
		var v = parseFloat(input.value);
		if (isNaN(v)) v = val;
		setValue(v);
	});

	input.addEventListener('keydown', function(e) {
		if (e.key === 'ArrowUp')   { e.preventDefault(); setValue(parseFloat(input.value) + step); }
		if (e.key === 'ArrowDown') { e.preventDefault(); setValue(parseFloat(input.value) - step); }
	});

	// API
	wrap.getValue = function() { return parseFloat(input.value); };
	wrap.setValue = function(v) { setValue(v, false); };
	wrap.setRange = function(mn, mx) { min = mn; max = mx; setValue(clamp(parseFloat(input.value))); };
	wrap.input = input;

	if (opts.tooltip) wrap.title = opts.tooltip;
	return wrap;
};

// ===================================================================
// EDIT FIELD (line edit)
// ===================================================================
FRWidget.EditField = function(opts) {
	opts = opts || {};

	var wrap = document.createElement('div');
	wrap.className = 'frw-edit';

	var input = document.createElement('input');
	input.className = 'frw-edit__input';
	input.type = 'text';
	if (opts.value)       input.value = opts.value;
	if (opts.placeholder) input.placeholder = opts.placeholder;
	if (opts.mono)        input.classList.add('frw-edit__input--mono');
	if (opts.onChange)    input.addEventListener('input', function() { opts.onChange(input.value); });

	wrap.appendChild(input);
	wrap.style.width = opts.width || '';

	// API
	wrap.getValue = function() { return input.value; };
	wrap.setValue = function(v) { input.value = v; };
	wrap.input = input;

	if (opts.tooltip) wrap.title = opts.tooltip;
	return wrap;
};

// ===================================================================
// COMBO BOX
// ===================================================================
FRWidget.ComboBox = function(opts) {
	opts = opts || {};

	var wrap = document.createElement('div');
	wrap.className = 'frw-combo';

	var select = document.createElement('select');
	select.className = 'frw-combo__select';

	var items = opts.items || [];
	for (var i = 0; i < items.length; i++) {
		var opt = document.createElement('option');
		if (typeof items[i] === 'object') {
			opt.value = items[i].value;
			opt.textContent = items[i].label;
		} else {
			opt.value = items[i];
			opt.textContent = items[i];
		}
		select.appendChild(opt);
	}

	if (opts.value !== undefined) select.value = opts.value;
	if (opts.onChange) select.addEventListener('change', function() { opts.onChange(select.value); });

	select.addEventListener('wheel', function(e) {
		e.preventDefault();
		var idx = select.selectedIndex + (e.deltaY > 0 ? 1 : -1);
		idx = Math.max(0, Math.min(select.options.length - 1, idx));
		if (idx !== select.selectedIndex) {
			select.selectedIndex = idx;
			select.dispatchEvent(new Event('change'));
		}
	}, { passive: false });

	wrap.appendChild(select);
	wrap.style.minWidth = opts.width || '';

	// API
	wrap.getValue = function() { return select.value; };
	wrap.setValue = function(v) { select.value = v; };
	wrap.select = select;

	if (opts.tooltip) wrap.title = opts.tooltip;
	return wrap;
};

// ===================================================================
// LIST WIDGET
// ===================================================================
FRWidget.ListWidget = function(opts) {
	opts = opts || {};

	var wrap = document.createElement('div');
	wrap.className = 'frw-list';
	if (opts.height) wrap.style.maxHeight = opts.height;

	var _selected = -1;
	var _items = [];
	var _onChange = opts.onChange || null;

	function render() {
		wrap.innerHTML = '';
		var data = opts.items || [];
		_items = [];

		if (data.length === 0) {
			var empty = document.createElement('div');
			empty.className = 'frw-list__item frw-list__item--empty';
			empty.textContent = opts.emptyText || '(empty)';
			wrap.appendChild(empty);
			return;
		}

		for (var i = 0; i < data.length; i++) {
			(function(idx) {
				var item = document.createElement('div');
				item.className = 'frw-list__item';
				item.textContent = data[idx];
				if (idx === _selected) item.classList.add('active');

				item.addEventListener('click', function() {
					_selected = idx;
					render();
					if (_onChange) _onChange(idx, data[idx]);
				});

				wrap.appendChild(item);
				_items.push(item);
			})(i);
		}
	}

	render();

	// API
	wrap.getSelected = function() { return _selected; };
	wrap.setItems = function(items) { opts.items = items; _selected = -1; render(); };
	wrap.refresh = render;

	return wrap;
};

// ===================================================================
// SLIDER CONTROLLER
// Mirrors TRSliderCtrl + TRCustomSpinController from Qt.
// Layout: [label] [spinbox] [−10] [−1] [+1] [+10]
//         [min] [=====slider=====] [max]
// ===================================================================
FRWidget.SliderCtrl = function(opts) {
	opts = opts || {};
	var min  = opts.min !== undefined ? opts.min : 0;
	var max  = opts.max !== undefined ? opts.max : 100;
	var val  = opts.value !== undefined ? opts.value : 50;
	var step = opts.step || 1;
	var decimals = opts.decimals || 0;
	var _onChange = opts.onChange || null;

	var wrap = document.createElement('div');
	wrap.className = 'frw-slider-ctrl';

	// -- Top row: label + spinbox + ±1/±10 buttons
	var topRow = document.createElement('div');
	topRow.className = 'frw-slider-ctrl__top';

	if (opts.label) {
		var lbl = document.createElement('span');
		lbl.className = 'frw-slider-ctrl__label';
		lbl.textContent = opts.label;
		topRow.appendChild(lbl);
	}

	var spinOpts = {
		min: min, max: max, value: val, step: step,
		suffix: opts.suffix,
		onChange: function(v) { updateAll(v, 'spin'); }
	};

	var spin = decimals > 0
		? FRWidget.DoubleSpinBox(Object.assign(spinOpts, { decimals: decimals }))
		: FRWidget.SpinBox(spinOpts);
	topRow.appendChild(spin);

	// Increment buttons: −10, −1, +1, +10
	var btnDec10 = FRWidget.Button('\u226210', { compact: true, tooltip: '-10',
		onClick: function() { updateAll(getCurrentVal() - 10, 'btn'); }
	});
	var btnDec1 = FRWidget.Button('\u22121', { compact: true, tooltip: '-1',
		onClick: function() { updateAll(getCurrentVal() - step, 'btn'); }
	});
	var btnInc1 = FRWidget.Button('+1', { compact: true, tooltip: '+1',
		onClick: function() { updateAll(getCurrentVal() + step, 'btn'); }
	});
	var btnInc10 = FRWidget.Button('+10', { compact: true, tooltip: '+10',
		onClick: function() { updateAll(getCurrentVal() + 10, 'btn'); }
	});

	topRow.appendChild(btnDec10);
	topRow.appendChild(btnDec1);
	topRow.appendChild(btnInc1);
	topRow.appendChild(btnInc10);
	wrap.appendChild(topRow);

	// -- Bottom row: min field + slider + max field
	var trackRow = document.createElement('div');
	trackRow.className = 'frw-slider-ctrl__track-row';

	var edtMin = document.createElement('input');
	edtMin.className = 'frw-slider-ctrl__minmax';
	edtMin.type = 'text';
	edtMin.value = min;

	var slider = document.createElement('input');
	slider.className = 'frw-slider-ctrl__slider';
	slider.type = 'range';
	slider.min = min;
	slider.max = max;
	slider.step = decimals > 0 ? step : step;
	slider.value = val;

	var edtMax = document.createElement('input');
	edtMax.className = 'frw-slider-ctrl__minmax';
	edtMax.type = 'text';
	edtMax.value = max;

	trackRow.appendChild(edtMin);
	trackRow.appendChild(slider);
	trackRow.appendChild(edtMax);
	wrap.appendChild(trackRow);

	// -- Wiring
	function getCurrentVal() {
		return decimals > 0 ? parseFloat(spin.getValue()) : parseInt(spin.getValue(), 10);
	}

	function clamp(v) { return Math.max(min, Math.min(max, v)); }

	function updateAll(v, source) {
		v = clamp(decimals > 0 ? parseFloat(v.toFixed(decimals)) : Math.round(v));
		if (source !== 'spin') spin.setValue(v);
		if (source !== 'slider') slider.value = v;
		if (_onChange) _onChange(v);
	}

	slider.addEventListener('input', function() {
		updateAll(decimals > 0 ? parseFloat(slider.value) : parseInt(slider.value, 10), 'slider');
	});

	edtMin.addEventListener('change', function() {
		min = parseFloat(edtMin.value) || 0;
		slider.min = min;
		spin.setRange(min, max);
		updateAll(clamp(getCurrentVal()), 'minmax');
	});

	edtMax.addEventListener('change', function() {
		max = parseFloat(edtMax.value) || 100;
		slider.max = max;
		spin.setRange(min, max);
		updateAll(clamp(getCurrentVal()), 'minmax');
	});

	// API
	wrap.getValue = function() { return getCurrentVal(); };
	wrap.setValue = function(v) { updateAll(v, 'api'); };
	wrap.spin = spin;
	wrap.slider = slider;

	if (opts.tooltip) wrap.title = opts.tooltip;
	return wrap;
};

// ===================================================================
// TREE WIDGET (planned — basic expandable structure)
// ===================================================================
FRWidget.TreeWidget = function(opts) {
	opts = opts || {};
	var wrap = document.createElement('div');
	wrap.className = 'frw-tree';

	var _data = opts.data || [];
	var _onChange = opts.onChange || null;

	function render() {
		wrap.innerHTML = '';

		for (var i = 0; i < _data.length; i++) {
			var node = _data[i];
			var isExpanded = node.expanded !== false;

			// Parent node
			var row = document.createElement('div');
			row.className = 'frw-tree__node';

			if (node.children && node.children.length > 0) {
				var toggle = document.createElement('span');
				toggle.className = 'frw-tree__toggle' + (isExpanded ? ' expanded' : '');
				toggle.textContent = '\u25B6'; // right triangle
				row.appendChild(toggle);

				(function(idx) {
					toggle.addEventListener('click', function(e) {
						e.stopPropagation();
						_data[idx].expanded = !_data[idx].expanded;
						render();
					});
				})(i);
			} else {
				var spacer = document.createElement('span');
				spacer.className = 'frw-tree__toggle';
				row.appendChild(spacer);
			}

			var label = document.createElement('span');
			label.textContent = node.label || node.text || '';
			row.appendChild(label);

			(function(idx) {
				row.addEventListener('click', function() {
					if (_onChange) _onChange(idx, _data[idx]);
				});
			})(i);

			wrap.appendChild(row);

			// Children
			if (isExpanded && node.children) {
				for (var c = 0; c < node.children.length; c++) {
					var child = node.children[c];
					var childRow = document.createElement('div');
					childRow.className = 'frw-tree__node frw-tree__node--child';

					var childLabel = document.createElement('span');
					childLabel.textContent = child.label || child.text || '';
					childRow.appendChild(childLabel);

					(function(pi, ci) {
						childRow.addEventListener('click', function() {
							if (_onChange) _onChange(pi, child, ci);
						});
					})(i, c);

					wrap.appendChild(childRow);
				}
			}
		}
	}

	render();

	// API
	wrap.setData = function(data) { _data = data; render(); };
	wrap.refresh = render;

	return wrap;
};

// ===================================================================
// TABLE WIDGET (planned — basic structure)
// ===================================================================
FRWidget.TableWidget = function(opts) {
	opts = opts || {};
	var table = document.createElement('table');
	table.className = 'frw-table';

	var _columns = opts.columns || [];
	var _rows = opts.rows || [];
	var _onChange = opts.onChange || null;

	function render() {
		table.innerHTML = '';

		// Header
		if (_columns.length > 0) {
			var thead = document.createElement('thead');
			var tr = document.createElement('tr');
			for (var c = 0; c < _columns.length; c++) {
				var th = document.createElement('th');
				th.textContent = _columns[c];
				tr.appendChild(th);
			}
			thead.appendChild(tr);
			table.appendChild(thead);
		}

		// Body
		var tbody = document.createElement('tbody');
		for (var r = 0; r < _rows.length; r++) {
			var row = document.createElement('tr');
			for (var c2 = 0; c2 < (_rows[r].length || 0); c2++) {
				var td = document.createElement('td');
				td.textContent = _rows[r][c2];
				row.appendChild(td);
			}
			(function(idx) {
				row.addEventListener('click', function() {
					// Toggle active
					var rows = tbody.querySelectorAll('tr');
					for (var k = 0; k < rows.length; k++) rows[k].classList.remove('active');
					row.classList.add('active');
					if (_onChange) _onChange(idx, _rows[idx]);
				});
			})(r);
			tbody.appendChild(row);
		}
		table.appendChild(tbody);
	}

	render();

	// API
	table.setData = function(columns, rows) { _columns = columns; _rows = rows; render(); };
	table.refresh = render;

	return table;
};

// ===================================================================
// COMBINED: SPIN BUTTON (spinbox + action button)
// ===================================================================
FRWidget.SpinButton = function(buttonText, opts) {
	opts = opts || {};

	var wrap = document.createElement('div');
	wrap.className = 'frw-spin-button';

	var spin = FRWidget.SpinBox({
		min: opts.min, max: opts.max,
		value: opts.value, step: opts.step,
		suffix: opts.suffix,
		onChange: opts.onSpinChange,
	});

	var btn = document.createElement('button');
	btn.className = 'frw-spin-button__action';
	btn.type = 'button';

	// Support icon or text for the action button
	if (opts.icon) {
		var ic = FRWidget.icon(opts.icon);
		if (ic) btn.appendChild(ic);
	}
	if (buttonText) {
		var span = document.createElement('span');
		span.textContent = buttonText;
		btn.appendChild(span);
	}

	if (opts.tooltip) btn.title = opts.tooltip;
	if (opts.onClick) btn.addEventListener('click', function() {
		opts.onClick(spin.getValue());
	});

	wrap.appendChild(spin);
	wrap.appendChild(btn);

	// API
	wrap.getValue = function() { return spin.getValue(); };
	wrap.setValue = function(v) { spin.setValue(v); };
	wrap.spin = spin;
	wrap.button = btn;

	return wrap;
};

// ===================================================================
// COMBINED: FLOW RIBBON (stretchable, reflowable button strip)
// ===================================================================
FRWidget.FlowRibbon = function(opts) {
	opts = opts || {};

	var wrap = document.createElement('div');
	wrap.className = 'frw-ribbon';

	// API: add widgets to the ribbon
	wrap.addWidget = function(widget) {
		wrap.appendChild(widget);
		return wrap;
	};

	wrap.addSeparator = function() {
		var sep = document.createElement('div');
		sep.className = 'frw-separator';
		wrap.appendChild(sep);
		return wrap;
	};

	return wrap;
};

// ===================================================================
// DIALOG (simple modal)
// ===================================================================
FRWidget.Dialog = function(opts) {
	opts = opts || {};

	var backdrop = document.createElement('div');
	backdrop.className = 'frw-dialog-backdrop';

	var dialog = document.createElement('div');
	dialog.className = 'frw-dialog';

	// Header
	var header = document.createElement('div');
	header.className = 'frw-dialog__header';

	var title = document.createElement('span');
	title.className = 'frw-dialog__title';
	title.textContent = opts.title || 'Dialog';

	var closeBtn = document.createElement('button');
	closeBtn.className = 'frw-dialog__close';
	closeBtn.type = 'button';
	closeBtn.textContent = '\u00D7'; // ×

	header.appendChild(title);
	header.appendChild(closeBtn);
	dialog.appendChild(header);

	// Body
	var body = document.createElement('div');
	body.className = 'frw-dialog__body';

	if (typeof opts.body === 'string') {
		body.innerHTML = opts.body;
	} else if (opts.body instanceof HTMLElement) {
		body.appendChild(opts.body);
	}

	dialog.appendChild(body);

	// Footer (optional buttons)
	if (opts.buttons) {
		var footer = document.createElement('div');
		footer.className = 'frw-dialog__footer';

		for (var i = 0; i < opts.buttons.length; i++) {
			var bCfg = opts.buttons[i];
			var btn = FRWidget.Button(bCfg.text, {
				primary: bCfg.primary,
				onClick: (function(cb) {
					return function() { if (cb) cb(); api.close(); };
				})(bCfg.onClick),
			});
			footer.appendChild(btn);
		}

		dialog.appendChild(footer);
	}

	backdrop.appendChild(dialog);

	// Close logic
	closeBtn.addEventListener('click', function() { api.close(); });
	backdrop.addEventListener('click', function(e) {
		if (e.target === backdrop) api.close();
	});

	// API
	var api = {
		el: backdrop,
		body: body,
		open: function() {
			document.body.appendChild(backdrop);
			requestAnimationFrame(function() {
				backdrop.classList.add('visible');
			});
		},
		close: function() {
			backdrop.classList.remove('visible');
			setTimeout(function() {
				if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
			}, 180);
			if (opts.onClose) opts.onClose();
		},
	};

	return api;
};

// ===================================================================
// UTILITY: Row (label + widget helper)
// ===================================================================
FRWidget.Row = function(labelText, widget) {
	var row = document.createElement('div');
	row.className = 'frw-row';
	row.appendChild(FRWidget.Label(labelText));
	row.appendChild(widget);
	return row;
};

FRWidget.Section = function(titleText) {
	var sec = document.createElement('div');
	sec.className = 'frw-section';
	var t = document.createElement('span');
	t.className = 'frw-section__title';
	t.textContent = titleText;
	sec.appendChild(t);
	return sec;
};

// ===================================================================
// CHECK TABLE WIDGET
// ===================================================================
// Table with a checkbox in the first column and optional row coloring.
// Mirrors TRCheckTableView from the Python/Qt codebase.
//
// opts.columns  — array of column header strings (excluding the check column)
// opts.rows     — array of { data: [col0, col1, ...], checked: bool, color: string|null }
// opts.colorMap — optional { 'value': 'rgba(...)' } for auto-coloring by a column value
// opts.colorCol — column index to match against colorMap (default: last column)
// opts.onChange — fn(rowIdx, checked) called when a checkbox toggles
// ===================================================================
FRWidget.CheckTableWidget = function(opts) {
	opts = opts || {};

	var wrap = document.createElement('div');
	wrap.className = 'frw-check-table';

	var table = document.createElement('table');
	table.className = 'frw-check-table__table';

	var _columns = opts.columns || [];
	var _rows = opts.rows || [];
	var _colorMap = opts.colorMap || {};
	var _colorCol = opts.colorCol !== undefined ? opts.colorCol : _columns.length - 1;
	var _onChange = opts.onChange || null;
	var _hiddenRows = {};  // row index → true if hidden by filter

	function render() {
		table.innerHTML = '';

		// -- Header
		var thead = document.createElement('thead');
		var htr = document.createElement('tr');

		var thCheck = document.createElement('th');
		thCheck.className = 'frw-check-table__th-check';
		thCheck.textContent = '';
		htr.appendChild(thCheck);

		for (var c = 0; c < _columns.length; c++) {
			var th = document.createElement('th');
			th.textContent = _columns[c];
			htr.appendChild(th);
		}
		thead.appendChild(htr);
		table.appendChild(thead);

		// -- Body
		var tbody = document.createElement('tbody');

		for (var r = 0; r < _rows.length; r++) {
			(function(idx) {
				var rowData = _rows[idx];
				var tr = document.createElement('tr');
				tr.dataset.rowIdx = idx;

				if (_hiddenRows[idx]) tr.style.display = 'none';

				// Row background color
				var bgColor = rowData.color || null;
				if (!bgColor && _colorMap) {
					var val = rowData.data[_colorCol];
					if (val && _colorMap[val]) bgColor = _colorMap[val];
				}
				if (bgColor) tr.style.backgroundColor = bgColor;

				// Checkbox cell
				var tdCheck = document.createElement('td');
				tdCheck.className = 'frw-check-table__td-check';
				var cb = document.createElement('input');
				cb.type = 'checkbox';
				cb.className = 'frw-check-table__checkbox';
				cb.checked = !!rowData.checked;
				cb.addEventListener('change', function() {
					rowData.checked = cb.checked;
					if (_onChange) _onChange(idx, cb.checked);
				});
				tdCheck.appendChild(cb);
				tr.appendChild(tdCheck);

				// Data cells
				for (var c = 0; c < rowData.data.length; c++) {
					var td = document.createElement('td');
					td.textContent = rowData.data[c] != null ? rowData.data[c] : '';
					tr.appendChild(td);
				}

				tbody.appendChild(tr);
			})(r);
		}

		table.appendChild(tbody);
	}

	render();
	wrap.appendChild(table);

	// -- API --

	// Set/replace all row data and re-render
	wrap.setData = function(columns, rows) {
		_columns = columns;
		_rows = rows;
		_hiddenRows = {};
		render();
	};

	// Get all rows (with .checked state)
	wrap.getRows = function() { return _rows; };

	// Get array of checked row indices
	wrap.getCheckedIndices = function() {
		var result = [];
		for (var i = 0; i < _rows.length; i++) {
			if (_rows[i].checked) result.push(i);
		}
		return result;
	};

	// Get array of checked row data arrays
	wrap.getCheckedData = function() {
		var result = [];
		for (var i = 0; i < _rows.length; i++) {
			if (_rows[i].checked) result.push(_rows[i].data);
		}
		return result;
	};

	// Check/uncheck all visible rows
	wrap.checkAll = function(checked) {
		for (var i = 0; i < _rows.length; i++) {
			if (!_hiddenRows[i]) _rows[i].checked = checked;
		}
		render();
	};

	// Toggle (swap) check state of all visible rows
	wrap.swapChecks = function() {
		for (var i = 0; i < _rows.length; i++) {
			if (!_hiddenRows[i]) _rows[i].checked = !_rows[i].checked;
		}
		render();
	};

	// Check/uncheck only rows matching a value in a given column
	wrap.checkByColumn = function(col, value, checked) {
		for (var i = 0; i < _rows.length; i++) {
			if (!_hiddenRows[i] && _rows[i].data[col] === value) {
				_rows[i].checked = checked;
			}
		}
		render();
	};

	// Filter rows: hide those where column `col` doesn't contain `text`
	wrap.filter = function(col, text) {
		var q = (text || '').toLowerCase();
		_hiddenRows = {};
		for (var i = 0; i < _rows.length; i++) {
			var val = String(_rows[i].data[col] || '').toLowerCase();
			if (q && val.indexOf(q) < 0) _hiddenRows[i] = true;
		}
		render();
	};

	// Clear all filters
	wrap.clearFilter = function() {
		_hiddenRows = {};
		render();
	};

	wrap.refresh = render;
	wrap.table = table;

	return wrap;
};
