# SCRIPT: FontRig / UFOrig
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
import xml.etree.ElementTree as ET

from itertools import product
from PyQt5 import QtCore, QtGui, QtWidgets
from typerig.core.fileio import cla, krn

# - Init ----------------------------
app_name, app_version = 'UFO Rig', '1.31'

# - Config ----------------------------
cfg_trw_columns_class = ['Tag/Key', 'Data/Value', 'Info']
cfg_file_open_formats = 'UFO Designspace (*.designspace);; UFO (*.plist);;'

# - Functions -----------------------
def xml_pretty_print(current, parent=None, index=-1, depth=0, indent='  '):
	''' Adapted from: https://stackoverflow.com/questions/28813876/how-do-i-get-pythons-elementtree-to-pretty-print-to-an-xml-file'''
	for i, node in enumerate(current):
		xml_pretty_print(node, current, i, depth + 1)
	
	if parent is not None:
		if index == 0:
			parent.text = '\n' + (indent * depth)
		else:
			parent[index - 1].tail = '\n' + (indent * depth)
		if index == len(parent) - 1:
			current.tail = '\n' + (indent * (depth - 1))
			
# - Widgets -------------------------
class trw_xml_explorer(QtWidgets.QTreeWidget):
	def __init__(self):
		super(trw_xml_explorer, self).__init__()
		
		# - Init
		self.font_bold = self.font()
		self.font_bold.setBold(True)
		self.font_italic = self.font()
		self.font_italic.setItalic(True)
		self.brush_gray = QtGui.QBrush(QtGui.QColor('Gray'))
		self.attrib_background = QtGui.QColor('Yellow')

		self.folder_attrib_name = 'attributes'
		self.folder_attrib_icon = self.style().standardIcon(QtWidgets.QStyle.SP_FileIcon)
		self.folder_children_name = 'children'
		self.folder_children_icon = self.style().standardIcon(QtWidgets.QStyle.SP_DirIcon)

		# - Style
		self.setSelectionMode(QtWidgets.QAbstractItemView.ExtendedSelection)
		self.setDragEnabled(True)
		self.setDragDropMode(self.InternalMove)
		self.setDropIndicatorShown(True)
		#self.header().setStretchLastSection(False)

		# - Menus
		self.context_menu = QtWidgets.QMenu(self)
		self.context_menu.setTitle('Actions:')
		act_addItem = QtWidgets.QAction('Add', self)
		act_delItem = QtWidgets.QAction('Remove', self)
		act_dupItem = QtWidgets.QAction('Duplicate', self)
		act_uneItem = QtWidgets.QAction('Unnest', self)
		
		self.context_menu.addAction(act_addItem)
		self.context_menu.addAction(act_delItem)
		self.context_menu.addAction(act_dupItem)
		self.context_menu.addAction(act_uneItem)
		
		act_addItem.triggered.connect(lambda: self._addItem())
		act_dupItem.triggered.connect(lambda: self._duplicateItems())
		act_uneItem.triggered.connect(lambda: self._unnestItem())
		act_delItem.triggered.connect(lambda: self._removeItems())

	# - Internals --------------------------
	def _removeItems(self):
		root = self.invisibleRootItem()
		
		for item in self.selectedItems():
			(item.parent() or root).removeChild(item)

	def _addItem(self, data=None, parent=None):
		new_item_data = ['New Item'] if data is None else data
		new_item = QtWidgets.QTreeWidgetItem(new_item_data)
		new_item.setFlags(new_item.flags() & ~QtCore.Qt.ItemIsDropEnabled | QtCore.Qt.ItemIsEditable)
		
		if parent is None and len(self.selectedItems()):
			parent = self.selectedItems()[0].parent()
		
		if parent is not None:
			parent.addChild(new_item)
		else:
			self.addTopLevelItem(new_item)

	def _duplicateItems(self):
		root = self.invisibleRootItem()
		
		for item in self.selectedItems():
			data = [item.text(c) for c in range(item.columnCount())]
			self._addItem(data)
		
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

	# - Getter/Setter -----------------------
	def __plural(self, obj, pair=['items', 'item']):
		size = len(obj)
		return '{} {}'.format(size, pair[size == 1])

	def __tree_walker_set(self, node, parent):
		# - Set Node	
		new_item_text = node.text.strip().strip('\n') if node.text is not None else ''
		new_item_info = '<{}> {} / {}'.format(node.tag, self.__plural(node), self.__plural(node.attrib, ['attributes', 'attribute']))
		new_item = QtWidgets.QTreeWidgetItem(parent, [node.tag, new_item_text, new_item_info])
		new_item.setFlags(new_item.flags() | QtCore.Qt.ItemIsEditable)
		new_item.setFont(2, self.font_italic)
		new_item.setForeground(2, self.brush_gray)
		
		if len(list(node)) or len(node.attrib):	
			new_item.setIcon(0, self.folder_children_icon)
		else:
			new_item.setIcon(0, self.folder_attrib_icon)

		# - Set Attributes
		for pair in node.attrib.items():
			new_attribute = QtWidgets.QTreeWidgetItem(new_item, [pair[0], pair[1], '... attribute of <{}>'.format(node.tag)])
			new_attribute.setIcon(0, self.folder_attrib_icon)
			new_attribute.setFont(2, self.font_italic)
			new_attribute.setForeground(2, self.brush_gray)
			new_attribute.setFlags(new_attribute.flags() | QtCore.Qt.ItemIsEditable)
			self.attrib_background.setAlpha(15)
			
			for col in range(self.columnCount()):
				new_attribute.setBackground(col, self.attrib_background)

		# - Set Children
		if len(node):
			for child in node:
				self.__tree_walker_set(child, new_item)

	def __tree_walker_get(self, node, parent):
		if node.childCount() or '...' not in str(node.text(2)):
			new_element = ET.Element(node.text(0))

			if len(node.text(1)):
				new_element.text = node.text(1)
			
			for c in range(node.childCount()):
				self.__tree_walker_get(node.child(c), new_element)

			parent.append(new_element)
		else:
			parent.set(node.text(0), node.text(1))

	def set_tree(self, data, headers):
		self.blockSignals(True)
		self.clear()
		self.setHeaderLabels(headers)
			
		# - Insert 
		if data is not None and isinstance(data, type(ET.ElementTree(None))):
			data_root = data.getroot()
			self.__tree_walker_set(data_root, self)

		self.expandAll()
		for c in range(self.columnCount()):
			self.resizeColumnToContents(c)	
		self.collapseAll()

		self.setAlternatingRowColors(True)
		self.blockSignals(False)

	def get_tree(self):
		root = self.invisibleRootItem().child(0)
		new_element = ET.Element(None)
		self.__tree_walker_get(root, new_element)
		xml_pretty_print(new_element)
		root_element = ET.ElementTree(new_element)
		return root_element
		

class wgt_designspace_manager(QtWidgets.QWidget):
	def __init__(self, data_tree):
		super(wgt_designspace_manager, self).__init__()
		
		# - Widgets
		# -- Trees
		self.trw_explorer = trw_xml_explorer()
		self.trw_explorer.set_tree(data_tree, cfg_trw_columns_class)

		# - Layout
		lay_main = QtWidgets.QVBoxLayout()
		lay_main.addWidget(self.trw_explorer)
		self.setLayout(lay_main)

# - Dialogs and Main -----------------------------------	
class main_ufo_manager(QtWidgets.QMainWindow):
	def __init__(self):
		super(main_ufo_manager, self).__init__()

		# - Init
		# -- Central Widget
		self.wgt_tabs = QtWidgets.QTabWidget()
		self.setCentralWidget(self.wgt_tabs)
		
		# -- Status bar
		self.status_bar = QtWidgets.QStatusBar()
		self.setStatusBar(self.status_bar)

		# - Menu bar
		self.menu_file = QtWidgets.QMenu('File', self)

		# -- Actions
		act_data_open_file = QtWidgets.QAction('Open', self)
		act_data_save_file = QtWidgets.QAction('Save', self)
		act_data_open_file.triggered.connect(self.file_open)
		act_data_save_file.triggered.connect(self.file_save)
		
		self.menu_file.addAction(act_data_open_file)
		self.menu_file.addAction(act_data_save_file)
	
		# -- Set Menu
		self.menuBar().addMenu(self.menu_file)

		# - Set
		self.setWindowTitle('%s %s' %(app_name, app_version))
		self.setGeometry(300, 100, 900, 720)

	# - File IO ---------------------------------------------
	# -- Classes Reader
	def file_save(self):
		curr_path = pathlib.Path(__file__).parent.absolute()
		
		# - Get data from current active tab
		curr_tab = self.wgt_tabs.widget(self.wgt_tabs.currentIndex())
		curr_data = curr_tab.trw_explorer.get_tree()
		export_file = QtWidgets.QFileDialog.getSaveFileName(self, 'Save file', str(curr_path), cfg_file_open_formats)

		if len(export_file[0]):
			with open(export_file[0], 'wb') as exportFile:
				curr_data.write(exportFile, encoding='utf-8', xml_declaration=True)
		
		self.status_bar.showMessage('File Saved: {}'.format(export_file[0]))
				
	def file_open(self):
		curr_path = pathlib.Path(__file__).parent.absolute()
		import_file = QtWidgets.QFileDialog.getOpenFileName(self, 'Open file', str(curr_path), cfg_file_open_formats)
			
		if len(import_file[0]):
			if '.designspace' in import_file[0]:
				file_tree = ET.parse(import_file[0])
				tab_caption = os.path.split(import_file[0])[1]
				self.wgt_tabs.addTab(wgt_designspace_manager(file_tree), tab_caption)

		self.status_bar.showMessage('File Loaded: {}'.format(import_file[0]))

# - Run -----------------------------
main_app = QtWidgets.QApplication(sys.argv)
main_dialog = main_ufo_manager()
main_dialog.show()
main_app.exec_()


