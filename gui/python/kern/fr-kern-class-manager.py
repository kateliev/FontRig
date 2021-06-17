# SCRIPT: FontRig / DTL CLA Manger
# DESCRIPTION:	
# -----------------------------------------------------------
# (C) Vassil Kateliev, 2021 		(http://www.kateliev.com)
# (C) Karandash Type Foundry 		(http://www.karandash.eu)
#------------------------------------------------------------
# www.typerig.com

# - Dependencies -----------------
import sys
from PyQt5 import QtCore, QtGui, QtWidgets

# - Init ----------------------------
global pLayers
pLayers = None
app_name, app_version = 'FontRig | Kern Class Manager', '1.0'

# - Test ----------------------------
test_data = {'Class':['A1', 'B2']}

# - Widgets -------------------------
class trw_class_explorer(QtWidgets.QTreeWidget):
	def __init__(self, source=True):
		super(trw_class_explorer, self).__init__()
		
		# - Init
		self.setSelectionMode(QtWidgets.QAbstractItemView.ExtendedSelection)
		self.setDragEnabled(True)
		self.locked = source
		
		if not self.locked: 
			self.setDragDropMode(self.DragDrop)
			self.setDropIndicatorShown(True)

			self.context_menu = QtWidgets.QMenu(self)
			self.context_menu.setTitle('Actions:')
			act_addItem = QtWidgets.QAction('Add', self)
			act_delItem = QtWidgets.QAction('Remove', self)
			act_dupItem = QtWidgets.QAction('Duplicate', self)
			act_uneItem = QtWidgets.QAction('UnNest', self)

			self.context_menu.addAction(act_addItem)
			self.context_menu.addAction(act_delItem)
			self.context_menu.addAction(act_dupItem)
			self.context_menu.addAction(act_uneItem)

			act_addItem.triggered.connect(lambda: self._addItem())
			act_dupItem.triggered.connect(lambda: self._duplicateItems())
			act_uneItem.triggered.connect(lambda: self._unnestItem())
			act_delItem.triggered.connect(lambda: self._removeItems())

		self.setAlternatingRowColors(True)
		self.expandAll()

	# - Internals --------------------------
	def _removeItems(self):
		root = self.invisibleRootItem()
		
		for item in self.selectedItems():
			(item.parent() or root).removeChild(item)

	def _addItem(self, data=None):
		new_item_data = ['New Sub Table', '', ''] if data is None else data
		new_item = QtWidgets.QTreeWidgetItem(new_item_data)
		new_item.setFlags(new_item.flags() & ~QtCore.Qt.ItemIsDropEnabled | QtCore.Qt.ItemIsEditable)
		
		root = self.selectedItems()[0].parent()
		if root is not None: 
			root.addChild(new_item)
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
			new_parent = old_parent.parent()
			ix = old_parent.indexOfChild(item)
			item_without_parent = old_parent.takeChild(ix)
			root.addChild(item_without_parent)
	
	def contextMenuEvent(self, event):
		if not self.locked: self.context_menu.popup(QtGui.QCursor.pos())

	# - Getter/Setter -----------------------
	def setTree(self, data, headers):
		self.blockSignals(True)
		self.clear()
		self.setHeaderLabels(headers)

		# - Insert 
		for key, value in data.items():
			parent = QtWidgets.QTreeWidgetItem([key])
			parent.setFlags(parent.flags() & ~QtCore.Qt.ItemIsDropEnabled | QtCore.Qt.ItemIsEditable)
			
			for item in value:
				new_child = QtWidgets.QTreeWidgetItem([item])
				parent.addChild(new_child)

			self.addTopLevelItem(parent)

		self.expandAll()
		self.blockSignals(False)

	def getTree(self):
		returnDict = OrderedDict()
		root = self.invisibleRootItem()

		for i in range(root.childCount()):
			item = root.child(i)
			returnDict[item.text(0)] = [[item.child(n).text(c) for c in range(item.child(n).columnCount())] for n in range(item.childCount())]
		
		return returnDict

# - Dialogs --------------------------------------		
class dlg_class_manager(QtWidgets.QDialog):
	def __init__(self):
		super(dlg_class_manager, self).__init__()
		
		# - Widgets
		trw_source_classes = trw_class_explorer()
		trw_source_classes.setTree(test_data, test_data.keys())

		trw_kern_assembler = trw_class_explorer(False)
		trw_kern_assembler.setTree({}, ['Sub Table/Classes', '1ST', '2ND'])
		
		# - Layout
		lay_main = QtWidgets.QGridLayout()
		lay_main.addWidget(trw_source_classes,	1, 0, 20, 1)
		lay_main.addWidget(trw_kern_assembler,	1, 1, 20, 1)

		# - Set
		self.setLayout(lay_main)
		self.setWindowTitle('%s %s' %(app_name, app_version))
		self.setGeometry(100, 100, 800, 600)

# - Run -----------------------------
main_app = QtWidgets.QApplication(sys.argv)
main_dialog = dlg_class_manager()
main_dialog.show()
main_app.exec_()


