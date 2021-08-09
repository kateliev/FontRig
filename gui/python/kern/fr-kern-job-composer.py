# SCRIPT: FontRig / DTL CLA Manger
# DESCRIPTION:	
# -----------------------------------------------------------
# (C) Vassil Kateliev, 2021 		(http://www.kateliev.com)
# (C) Karandash Type Foundry 		(http://www.karandash.eu)
#------------------------------------------------------------
# www.typerig.com

# - Dependencies -----------------
import os
import sys
import pathlib
import json
import plistlib

from itertools import product
from PyQt5 import QtCore, QtGui, QtWidgets
from typerig.core.fileio import cla, krn

# - Init ----------------------------
app_name, app_version = 'FontRig | Kern Job Composer', '2.17'

# - Config ----------------------------
cfg_trw_columns_class = ['Class', 'Members']
cfg_trw_columns_pairs = ['Group / Class', 'A <<', '<< A']
cfg_file_open_formats = 'DTL Classes (*.cla);; UFO Groups (*.plist);;'
cfg_file_save_formats = 'DTL Kern Pairs (*.krn);;'
cfg_glyph_separator = ' '
cfg_class_mark = '@'
cfg_ufo_group_prefix = 'public.kern'

# - Widgets -------------------------
class trw_class_explorer(QtWidgets.QTreeWidget):
	def __init__(self, set_checks=False):
		super(trw_class_explorer, self).__init__()
		
		# - Init
		self.setSelectionMode(QtWidgets.QAbstractItemView.ExtendedSelection)
		self.setDragEnabled(True)
		self.trw_checks = set_checks
		
		self.setDragDropMode(self.DragDrop)
		self.setDropIndicatorShown(True)

		self.context_menu = QtWidgets.QMenu(self)
		self.context_menu.setTitle('Actions:')
		act_addItem = QtWidgets.QAction('Add', self)
		act_delItem = QtWidgets.QAction('Remove', self)
		act_dupItem = QtWidgets.QAction('Duplicate', self)
		act_uneItem = QtWidgets.QAction('Unnest', self)
		act_set1st = QtWidgets.QAction('1ST', self)
		act_set2nd = QtWidgets.QAction('2ND', self)
		act_setclass = QtWidgets.QAction('Class', self)

		self.context_menu.addAction(act_addItem)
		self.context_menu.addAction(act_delItem)
		self.context_menu.addAction(act_dupItem)
		self.context_menu.addAction(act_uneItem)
		self.context_menu.addSeparator()
		self.context_menu.addAction(act_set1st)
		self.context_menu.addAction(act_set2nd)
		self.context_menu.addAction(act_setclass)

		act_addItem.triggered.connect(lambda: self._addItem())
		act_dupItem.triggered.connect(lambda: self._duplicateItems())
		act_uneItem.triggered.connect(lambda: self._unnestItem())
		act_delItem.triggered.connect(lambda: self._removeItems())
		act_set1st.triggered.connect(lambda: self._setCheck(1))
		act_set2nd.triggered.connect(lambda: self._setCheck(2))
		act_setclass.triggered.connect(lambda: self._setClass())

		self.setAlternatingRowColors(True)
		self.expandAll()

	# - Internals --------------------------
	def _removeItems(self):
		root = self.invisibleRootItem()
		
		for item in self.selectedItems():
			(item.parent() or root).removeChild(item)

	def _addItem(self, data=None, parent=None, set_checks=False):
		new_item_data = ['New Item'] if data is None else data
		new_item = QtWidgets.QTreeWidgetItem(new_item_data)
		new_item.setFlags(new_item.flags() & ~QtCore.Qt.ItemIsDropEnabled | QtCore.Qt.ItemIsEditable)
		
		if parent is None and len(self.selectedItems()):
			parent = self.selectedItems()[0].parent()
		
		if parent is not None:
			parent.addChild(new_item)
		else:
			self.addTopLevelItem(new_item)

		if set_checks:
			chk_1 = QtWidgets.QCheckBox('1ST')
			chk_2 = QtWidgets.QCheckBox('2ND')
			self.setItemWidget(new_item, 1, chk_1)
			self.setItemWidget(new_item, 2, chk_2)

	def _setCheck(self, column=1):
		selection = self.selectedItems()
		for item in selection:
			item_widget = self.itemWidget(item, column)
			if isinstance(item_widget, QtWidgets.QCheckBox):
				item_widget.setChecked(not item_widget.isChecked())

	def _setClass(self):
		selection = self.selectedItems()
		for item in selection:
			if cfg_class_mark in item.text(0):
				item.setText(0, item.text(0).replace(cfg_class_mark, ''))
			else:
				item.setText(0, '{}{}'.format(cfg_class_mark, item.text(0)))  

	def _duplicateItems(self):
		root = self.invisibleRootItem()
		
		for item in self.selectedItems():
			data = [item.text(c) for c in range(item.columnCount())]
			self._addItem(data, set_checks=self.trw_checks)
		
	def _unnestItem(self):
		root = self.invisibleRootItem()
		
		for item in reversed(self.selectedItems()):
			old_parent = item.parent()
			
			if old_parent is not None:
				new_parent = old_parent.parent()
				ix = old_parent.indexOfChild(item)
				item_without_parent = old_parent.takeChild(ix)
				root.addChild(item_without_parent)
	
	# - Event Handlers ----------------------
	def contextMenuEvent(self, event):
		self.context_menu.popup(QtGui.QCursor.pos())

	def dropEvent(self, event):
		source = event.source().selectedItems()
		destination = self.itemAt(event.pos())
		modifiers = QtWidgets.QApplication.keyboardModifiers()

		for item in source:
			if modifiers != QtCore.Qt.AltModifier:
				data = [item.text(0)]
			else:
				data = [item.text(1)]

			self._addItem(data, destination, self.trw_checks)
		
		event.acceptProposedAction()

	# - Getter/Setter -----------------------
	def set_tree(self, data, headers, set_checks=False):
		self.blockSignals(True)
		self.clear()
		self.setHeaderLabels(headers)

		header = self.header()
		#header.setSectionResizeMode(QtWidgets.QHeaderView.ResizeToContents)
		header.setStretchLastSection(not self.trw_checks)
		if self.trw_checks:	header.setSectionResizeMode(0, QtWidgets.QHeaderView.Stretch)

		# - Insert 
		for parent_name, item_data in data:
			parent = QtWidgets.QTreeWidgetItem([parent_name])
			parent.setFlags(parent.flags() & ~QtCore.Qt.ItemIsDropEnabled | QtCore.Qt.ItemIsEditable)
			self.addTopLevelItem(parent)
			
			for item in item_data:
				if not set_checks:
					new_item = [item[0], cfg_glyph_separator.join(item[1])]
					new_child = QtWidgets.QTreeWidgetItem(new_item)
					new_child.setFlags(new_child.flags() & ~QtCore.Qt.ItemIsDropEnabled | QtCore.Qt.ItemIsEditable)
					parent.addChild(new_child)
				else:
					new_child = QtWidgets.QTreeWidgetItem([item[0]])
					new_child.setFlags(new_child.flags() & ~QtCore.Qt.ItemIsDropEnabled | QtCore.Qt.ItemIsEditable)
					parent.addChild(new_child)

					chk_1 = QtWidgets.QCheckBox('1ST')
					chk_2 = QtWidgets.QCheckBox('2ND')

					chk_1.setChecked(item[1])
					chk_2.setChecked(item[2])

					self.setItemWidget(new_child, 1, chk_1)
					self.setItemWidget(new_child, 2, chk_2)

		self.expandAll()
		self.setAlternatingRowColors(True)
		self.blockSignals(False)

	def get_tree(self, get_checks=True):
		return_data = []
		root = self.invisibleRootItem()

		for i in range(root.childCount()):
			item = root.child(i)
			
			if get_checks:
				item_export = [item.text(0), [(item.child(n).text(0), self.itemWidget(item.child(n), 1).isChecked(), self.itemWidget(item.child(n), 2).isChecked()) for n in range(item.childCount())]]
			else:
				item_export = [(item.child(n).text(0), item.child(n).text(1).split(cfg_glyph_separator)) for n in range(item.childCount())]
			
			return_data.append(item_export)
		
		return return_data

class lay_flow_sorter(QtWidgets.QLayout):
	def __init__(self, parent=None, margin=-1, hspacing=-1, vspacing=-1, aux=None):
		super(lay_flow_sorter, self).__init__(parent)
		self._hspacing = hspacing
		self._vspacing = vspacing
		self._items = []
		self._aux = aux
		self.setContentsMargins(margin, margin, margin, margin)

	def __del__(self):
		del self._items[:]

	def addItem(self, item):
		self._items.append(item)

	def addItems(self, items_list):
		self.clear()
		for text_item in items_list:
			member = QtWidgets.QPushButton(text_item)
			member.setFixedWidth(member.sizeHint().width())
			member.clicked.connect(lambda a, w=text_item: self.itemFirst(w))
			member.setToolTip('Promote member as class leader')
			self.addWidget(member)

	def getItems(self):
		return [self.itemAt(i).widget().text() for i in range(self.count())]

	def horizontalSpacing(self):
		if self._hspacing >= 0:
			return self._hspacing
		else:
			return self.smart_spacing(QtWidgets.QStyle.PM_LayoutHorizontalSpacing)

	def verticalSpacing(self):
		if self._vspacing >= 0:
			return self._vspacing
		else:
			return self.smart_spacing(QtWidgets.QStyle.PM_LayoutVerticalSpacing)

	def count(self):
		return len(self._items)

	def clear(self):
		for i in reversed(range(self.count())): 
			self.itemAt(i).widget().setParent(None)

	def itemFirst(self, string):
		for i in range(len(self._items)):
			if string == self._items[i].widget().text():
				break

		new_head = self._items.pop(i)
		self._items.insert(0, new_head)
		self.update()

		if self._aux is not None:
			self._aux.selectedItems()[0].setText(1, cfg_glyph_separator.join(self.getItems()))

	def itemAt(self, index):
		if 0 <= index < len(self._items):
			return self._items[index]

	def takeAt(self, index):
		if 0 <= index < len(self._items):
			return self._items.pop(index)

	def expandingDirections(self):
		return QtCore.Qt.Orientations(0)

	def hasHeightForWidth(self):
		return True

	def heightForWidth(self, width):
		return self.set_layout(QtCore.QRect(0, 0, width, 0), True)

	def setGeometry(self, rect):
		super(lay_flow_sorter, self).setGeometry(rect)
		self.set_layout(rect, False)

	def sizeHint(self):
		return self.minimumSize()

	def minimumSize(self):
		size = QtCore.QSize()

		for item in self._items:
			size = size.expandedTo(item.minimumSize())

		left, top, right, bottom = self.getContentsMargins()
		size += QtCore.QSize(left + right, top + bottom)
		return size

	def set_layout(self, rect, testonly):
		left, top, right, bottom = self.getContentsMargins()
		effective = rect.adjusted(+left, +top, -right, -bottom)
		x = effective.x()
		y = effective.y()
		lineheight = 0
		
		for item in self._items:
			widget = item.widget()
			hspace = self.horizontalSpacing()

			if hspace == -1:
				hspace = widget.style().layoutSpacing(
					QtWidgets.QSizePolicy.PushButton,
					QtWidgets.QSizePolicy.PushButton, QtCore.Qt.Horizontal)

			vspace = self.verticalSpacing()
			
			if vspace == -1:
				vspace = widget.style().layoutSpacing(
					QtWidgets.QSizePolicy.PushButton,
					QtWidgets.QSizePolicy.PushButton, QtCore.Qt.Vertical)
			nextX = x + item.sizeHint().width() + hspace
			
			if nextX - hspace > effective.right() and lineheight > 0:
				x = effective.x()
				y = y + lineheight + vspace
				nextX = x + item.sizeHint().width() + hspace
				lineheight = 0

			if not testonly:
				item.setGeometry(
					QtCore.QRect(QtCore.QPoint(x, y), item.sizeHint()))
			x = nextX
			lineheight = max(lineheight, item.sizeHint().height())
		return y + lineheight - rect.y() + bottom

	def smart_spacing(self, pm):
		parent = self.parent()
		if parent is None:
			return -1
		elif parent.isWidgetType():
			return parent.style().pixelMetric(pm, None, parent)
		else:
			return parent.spacing()

class wgt_class_manager(QtWidgets.QWidget):
	def __init__(self):
		super(wgt_class_manager, self).__init__()
		
		# - Widgets
		# -- Trees
		self.trw_source_classes = trw_class_explorer()
		self.trw_source_classes.set_tree([], cfg_trw_columns_class)
		self.trw_source_classes.selectionModel().selectionChanged.connect(lambda: self.set_sorter())

		self.trw_kern_assembler = trw_class_explorer(True)
		self.trw_kern_assembler.set_tree([], cfg_trw_columns_pairs)

		# -- Cutom layout
		self.scr_class_sorter = QtWidgets.QScrollArea(self)
		self.scr_class_sorter.setWidgetResizable(True)
		self.lay_class_sorter = lay_flow_sorter(self.scr_class_sorter, margin=5, hspacing=2, vspacing=2, aux=self.trw_source_classes)

		# - Layout
		lay_main = QtWidgets.QVBoxLayout()
		lay_3_plane = QtWidgets.QGridLayout()
		lay_3_plane.addWidget(QtWidgets.QLabel('Classes Manager:'),	1, 0, 1, 1)
		lay_3_plane.addWidget(QtWidgets.QLabel('Pairs Composer:'),	1, 1, 1, 1)
		lay_3_plane.addWidget(self.trw_source_classes,		2, 0, 80, 1)
		lay_3_plane.addWidget(self.trw_kern_assembler,		2, 1, 80, 1)
		#lay_3_plane.addWidget(QtWidgets.QLabel('Class Organizer:'),	82, 0, 1, 1)
		lay_3_plane.addWidget(self.scr_class_sorter,		83, 0, 10, 2)

		lay_main.addLayout(lay_3_plane)

		self.setLayout(lay_main)

	# - Functions -------------------------------------
	def set_sorter(self):
		try:
			class_members = self.trw_source_classes.selectedItems()[0].text(1).split()
			self.lay_class_sorter.addItems(class_members)
		except IndexError:
			self.lay_class_sorter.clear()

	def gen_kern_pairs(self):
		pair_groups = [item[1] for item in self.trw_kern_assembler.get_tree(True)]
		pair_export = []
		
		for group in pair_groups:
			group_1st = []
			group_2nd = []
			
			for item, left, right in group:
				kern_item = item.split(cfg_glyph_separator)
				if left: group_1st.append(kern_item)
				if right: group_2nd.append(kern_item)

			group_1st = set(sum(sorted(group_1st),[]))
			group_2nd = set(sum(sorted(group_2nd),[]))
			pair_export.append(list(product(group_1st, group_2nd)))
		
		pair_export = sum(pair_export, [])
		return pair_export

# - Dialogs and Main -----------------------------------	
class main_class_manager(QtWidgets.QMainWindow):
	def __init__(self):
		super(main_class_manager, self).__init__()

		# - Init
		# -- Central Widget
		self.class_manager = wgt_class_manager()
		self.setCentralWidget(self.class_manager)
		
		# -- Status bar
		self.status_bar = QtWidgets.QStatusBar()
		self.setStatusBar(self.status_bar)

		# - Menu bar
		self.menu_file = QtWidgets.QMenu('File', self)

		# -- Actions
		act_data_open_class = QtWidgets.QAction('Open Classes', self)
		act_data_save_class = QtWidgets.QAction('Save Classes', self)
		act_data_open_class.triggered.connect(self.file_open_classes)
		act_data_save_class.triggered.connect(self.file_save_classes)
		
		act_data_open_comp = QtWidgets.QAction('Open Composition', self)
		act_data_save_comp = QtWidgets.QAction('Save Composition', self)
		act_data_open_comp.triggered.connect(self.file_open_comp)
		act_data_save_comp.triggered.connect(self.file_save_comp)

		act_data_save_pairs = QtWidgets.QAction('Save Pairs', self)
		act_data_save_pairs.triggered.connect(self.file_save_pairs)

		self.menu_file.addAction(act_data_open_class)
		self.menu_file.addAction(act_data_save_class)
		self.menu_file.addSeparator()
		self.menu_file.addAction(act_data_open_comp)
		self.menu_file.addAction(act_data_save_comp)
		self.menu_file.addSeparator()
		self.menu_file.addAction(act_data_save_pairs)

		# -- Set Menu
		self.menuBar().addMenu(self.menu_file)

		# - Set
		self.setWindowTitle('%s %s' %(app_name, app_version))
		self.setGeometry(300, 100, 900, 720)

	# - File IO ---------------------------------------------
	# -- Classes Reader
	def file_save_classes(self):
		export_class = self.class_manager.trw_source_classes.get_tree(False)
		curr_path = pathlib.Path(__file__).parent.absolute()
		export_file = QtWidgets.QFileDialog.getSaveFileName(self, 'Save Classes to file', str(curr_path), cfg_file_open_formats)

		if len(export_file[0]):
			if '*.cla' in export_file[1]:
				with cla.CLAparser(export_file[0], 'w') as writer:
					writer.dump(export_class[0])
			
			# - Unknown type or Cancel
			else:
				return
		
		self.status_bar.showMessage('{} Kerning Classes Saved to: {}'.format(len(export_class[0]), export_file[0]))
				
	def file_open_classes(self):
		import_classes = []
		temp_classes = []
		curr_path = pathlib.Path(__file__).parent.absolute()
		import_file = QtWidgets.QFileDialog.getOpenFileName(self, 'Load Kerning Classes from file', str(curr_path), cfg_file_open_formats)
			
		if len(import_file[0]):
			# - DTL Classes File
			if '*.cla' in import_file[1]:
				with cla.CLAparser(import_file[0]) as reader:
					for line in reader:
						import_classes.append(line)

			# - OT Feature File
			elif '*.plist' in import_file[1]:
				with open(import_file[0], 'rb') as reader:
					temp_classes = plistlib.load(reader)
			
				for group_name, group_members in temp_classes.items():
					if cfg_ufo_group_prefix in group_name:
						import_classes.append((group_name[len(cfg_ufo_group_prefix)+2:], group_members))

			# - Unknown type or Cancel
			else:
				return

		load_data = [(import_file[0], import_classes)]
		self.class_manager.trw_source_classes.set_tree(load_data, cfg_trw_columns_class)
		self.status_bar.showMessage('{} Kerning Classes Loaded from: {}'.format(len(load_data[0][1]), import_file[0]))

	def file_save_comp(self):
		export_comp = self.class_manager.trw_kern_assembler.get_tree()
		curr_path = pathlib.Path(__file__).parent.absolute()
		export_file = QtWidgets.QFileDialog.getSaveFileName(self, 'Save Pairs Composition to file', str(curr_path), '(*.json);;')
		
		if len(export_file[0]):
			with open(export_file[0], 'w') as writer:
				json.dump(export_comp, writer)
		else:
			return

		self.status_bar.showMessage('{} Composition Groups Saved to: {}'.format(len(export_comp), export_file[0]))

	def file_open_comp(self):
		curr_path = pathlib.Path(__file__).parent.absolute()
		import_file = QtWidgets.QFileDialog.getOpenFileName(self, 'Load Pairs Composition from file', str(curr_path), '(*.json);;')

		if len(import_file[0]):
			with open(import_file[0], 'r') as reader:
				import_comp = json.load(reader)
		else:
			return

		self.class_manager.trw_kern_assembler.set_tree(import_comp, cfg_trw_columns_pairs, True)
		self.status_bar.showMessage('{} Composition Groups Loaded from: {}'.format(len(import_comp), import_file[0]))

	def file_save_pairs(self):
		export_pairs = self.class_manager.gen_kern_pairs()
		curr_path = pathlib.Path(__file__).parent.absolute()
		export_file = QtWidgets.QFileDialog.getSaveFileName(self, 'Save Kerning Pairs to file', str(curr_path), cfg_file_save_formats)
			
		if len(export_file[0]):
			# - DTL Kern pair file File
			if '*.krn' in export_file[1]:
				with krn.KRNparser(export_file[0], 'w') as writer:
					writer.dump(sorted(export_pairs), 'Application: {} Version: {}'.format(app_name, app_version))

			# - Unknown type or Cancel
			else:
				return

			self.status_bar.showMessage('{} Kerning Pairs Saved to: {}'.format(len(export_pairs), export_file[0]))

# - Run -----------------------------
main_app = QtWidgets.QApplication(sys.argv)
main_dialog = main_class_manager()
main_dialog.show()
main_app.exec_()


