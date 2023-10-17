# SCRIPT: 	FontRig: fr-rename
# NOTE: 	Rename a *.ttf or *.otf file
# -----------------------------------------------------------
# (C) Vassil Kateliev, 2023 		(http://www.kateliev.com)
#------------------------------------------------------------

# No warranties. By using this you agree
# that you use it at your own risk!

# - Dependencies --------------------------------
__requires__ = ['fontTools']

import os, sys, argparse, json, pprint
from inspect import getmembers

#from fontTools.misc.py23 import *
from fontTools import ttLib

# -- String -------------------------------------
__version__ = 1.5

tool_name = 'FR-RENAME'
tool_description = 'FontRig | Rename a *.ttf or *.otf file'

# - Helpers -------------------------------------
def _output(i, message):
	msg_type = ['DONE', 'WARN', 'INFO', 'ERROR']
	print('{}:\t{}.'.format(msg_type[i], message))

def _get_record(record_list, index):
	for record in record_list:
		if record.nameID == index:
			return record.string.decode(record.getEncoding())

def _set_record(record_list, index, value):
	for record in record_list:
		if record.nameID == index:
			record.string = value

def _get_properties(object):
	return [name for name, value in getmembers(object, lambda x: isinstance(x, property))]

# - Clases --------------------------------------
class FRfontNames(object):
	'''Fonts Names Object for dealing with name tables'''

	def __init__(self, file_path):
		self.file_path = file_path
		self.font = ttLib.TTFont(self.file_path)
		self.is_cff = 'CFF ' in self.font
		
	# - Properties -------------------------------------
	@property
	def cff_FamilyName(self):
		if self.is_cff:
			return	self.font['CFF '].cff[0].FamilyName

	@cff_FamilyName.setter
	def cff_FamilyName(self, value):
		if self.is_cff:
			self.font['CFF '].cff[0].FamilyName = value

	@property
	def cff_FullName(self):
		if self.is_cff:
			return	self.font['CFF '].cff[0].FullName

	@cff_FullName.setter
	def cff_FullName(self, value):
		if self.is_cff:
			self.font['CFF '].cff[0].FullName = value

	@property
	def cff_fontNames(self):
		if self.is_cff:
			return	self.font['CFF '].cff.fontNames

	@cff_fontNames.setter
	def cff_fontNames(self, value):
		if self.is_cff:
			self.font['CFF '].cff.fontNames = value

	@property
	def font_family_name(self):
		return 	_get_record(self.font['name'].names, 1)

	@font_family_name.setter
	def font_family_name(self, value):
		_set_record(self.font['name'].names, 1, value)

	@property
	def font_style_name(self):
		return 	_get_record(self.font['name'].names, 2)

	@font_style_name.setter
	def font_style_name(self, value):
		_set_record(self.font['name'].names, 2, value)

	@property
	def font_full_name(self):
		return 	_get_record(self.font['name'].names, 4)

	@font_full_name.setter
	def font_full_name(self, value):
		_set_record(self.font['name'].names, 4, value)

	@property
	def postscript_name(self):
		return 	_get_record(self.font['name'].names, 6)

	@postscript_name.setter
	def postscript_name(self, value):
		_set_record(self.font['name'].names, 6, value.replace(' ', ''))

	@property
	def trademark(self):
		return	_get_record(self.font['name'].names, 0)	

	@trademark.setter
	def trademark(self, value):
		_set_record(self.font['name'].names, 0, value)	

	# - Procedures ---------------------------------------
	def build_names(self, name_string, style_string=''):
		if not len(style_string):
			if self.font_style_name is not None and len(self.font_style_name):
				style_string = self.font_style_name
		
			else:
			 	output(3, 'Missing font style name\nQuitting...')
			 	sys.exit(1)

		self.font_family_name = name_string # what about ID16?
		self.font_full_name = '{} {}'.format(name_string, style_string)
		self.postscript_name = '{}-{}'.format(name_string.replace(' ', ''), style_string.replace(' ', ''))

		if self.is_cff:
		    self.cff_FamilyName = self.font_family_name
		    self.cff_FullName = self.font_full_name
		    self.cff_fontNames = self.postscript_name


	def save(self, output_path=None):
		output_path = self.file_path if output_path is None else output_path
		self.font.save(output_path)
	
	def dump(self):
		properties = _get_properties(FRfontNames)
		return [(prop, getattr(self, prop)) for prop in properties]

	def fromDict(self, names_dict:dict):
		for item, value in names_dict.items():
			self[item] = value

# -- Setup CLI
arg_parser = argparse.ArgumentParser(prog=tool_name, description=tool_description)

arg_parser.add_argument('File',
						type=str,
						metavar='font file',
						help='A *.ttf or *.otf font file(s)')
						

arg_parser.add_argument('--output-path', '-o',
						type=str,
						metavar='path',
						required=False,
						help='Optional output folder')

arg_parser.add_argument('--name', '-n',
						type=str,
						metavar='str',
						required=False,
						help='Auto build new font names and name tables')

arg_parser.add_argument('--style', '-s',
						type=str,
						metavar='str',
						required=False,
						help='Set new style name')

arg_parser.add_argument('--report-names', '-r',
						action='store_true',
						required=False,
						help='Report font names and name tables')

arg_parser.add_argument('--dump-names', '-d',
						action='store_true',
						required=False,
						help='Dump font names and name tables')

for prop in _get_properties(FRfontNames):
	arg_parser.add_argument('--{}'.format(prop),
							type=str,
							metavar='str',
							required=False,
							help='Set font {} value'.format(prop))	

arg_parser.add_argument('--version', '-v',
						action="version",
						version='{} | {} | VER. {}'.format(tool_name, tool_description, __version__),
						help='Show tool version.')

args = arg_parser.parse_args()

# -- Paths and configuration
font_file = args.File
work_path = os.path.split(font_file)[0]

# - Begin ----------------------------------------------------------
_output(2, 'FontRig | {} ver. {}'.format(tool_name, __version__))

if not os.path.exists(work_path): 
	try:
		os.makedirs(work_path)
		_output(0, 'Creating folder: {}'.format(work_path))
	
	except OSError:
		the_error = 'Creating folder: {}; Aborting'.format(work_path)
		_output(-1, the_error)
		sys.exit(1)

# -- Process
font_names_data = FRfontNames(font_file)
font_filename = os.path.split(font_file)[1]
font_save_path = args.output_path if args.output_path else os.path.join(work_path, font_filename)

changes_made = False

# - Process
if args.report_names:
	report_string = '{deco}\nFont:\t{font}\n{deco}\n{names}\n'.format(deco='-'*40, font=font_filename, names='\n'.join(['{} : {}'.format(item[0],item[1]) for item in font_names_data.dump()]))
	print(report_string)
	
elif args.dump_names:
	font_names_data_dump_filename = os.path.join(work_path, os.path.splitext(font_filename)[0] + '-names-dump.json')
	with open(font_names_data_dump_filename, 'w') as json_tree:
		json_tree.write(json.dumps(font_names_data.dump()))
	
	_output(0,'Saved font names dump: {}'.format(font_names_data_dump_filename))
	
else:
	if args.name is not None:
		new_name = str(args.name)
		new_style = str(args.style) if args.style is not None else ''
		
		font_names_data.build_names(args.name, new_style)
		changes_made = True

# - Save changes
if changes_made:
	font_names_data.save(font_save_path)
	_output(0,'Saved Font: {}'.format(font_save_path))



	

