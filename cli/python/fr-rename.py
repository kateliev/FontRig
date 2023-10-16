# SCRIPT: 	FontRig: fr-rename
# NOTE: 	Rename a *.ttf or *.otf file
# -----------------------------------------------------------
# (C) Vassil Kateliev, 2023 		(http://www.kateliev.com)
#------------------------------------------------------------

# No warranties. By using this you agree
# that you use it at your own risk!

# - Dependencies --------------------------------
from __future__ import absolute_import, print_function, unicode_literals

__requires__ = ['fontTools']

import os, glob, argparse, json

from fontTools.misc.py23 import *
from fontTools import ttLib

# -- String -------------------------------------
__version__ = 1.0

tool_name = 'FR-RENAME'
tool_description = 'FontRig | Rename a *.ttf or *.otf file'

# -- Configuration
# -- lookup_name: (parent, accessor, is_dict)
lookup_dict = {	'cff_FamilyName':			('CFF', 0, True),
				'cff_FullName':				('CFF', 0, True),
				'cff_fontNames':			('CFF', None, None),
				
				'mac_font_family_name': 	('names', 1, False),
				'mac_font_style_name': 		('names', 4, False),
				'mac_postscript_name': 		('names', 6, False),
				'mac_trademark':			('names', 7, False),
				
				'ms_font_family_name': 		('names', 15, False),
				'ms_font_style_name': 		('names', 16, False),
				'ms_font_full_name': 		('names', 18, False),
				'ms_trademark': 			('names', 21, False),
			}

# - Helpers -------------------------------------
def _output(i, message):
	msg_type = ['DONE', 'WARN', 'INFO', 'ERROR']
	print('{}:\t{}.'.format(msg_type[i], message))

def _get_record(record_list, index):
	for record in record_list:
		if record.nameID == index:
			return record

# - Clases --------------------------------------
class FRfontNames(object):
	'''Fonts Names Object for dealing with nametables'''

	def __init__(self, file_path):
		self.file_path = file_path
		self.font = ttLib.TTFont(self.file_path)
	
	# - Internals
	def __getitem__(self, item):
		if item in lookup_dict.keys():
			parent, accessor, is_dict = lookup_dict[item]
			
			try:
				table = getattr(self.font, parent)

				if is_dict:
					return getattr(table, accessor)
				else:
					return _get_record(table, accessor)

			except:
				_output(3, 'Cannot access/read table: {}'.format(parent))

		
	def __setitem__(self, item, value):
		if item in lookup_dict.keys():
			parent, accessor, is_dict = lookup_dict[item]
			
			try:
				table = getattr(self.font, parent)

				if is_dict:
					setattr(table, accessor, value)
				else:
					setattr(_get_record(table, accessor), 'string', value)

			except:
				_output(3, 'Cannot access/write to table: {}'.format(parent))

	# - Procedures 
	def save(self, output_path=None):
		output_path = self.file_path if output_path is None else output_path
		self.font.save(output_path)
	
	def dump(self):
		return [(item, self[item]) for item in lookup_dict.keys()]

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
						metavar='path',
						required=False,
						help='Set new font name')

arg_parser.add_argument('--style', '-s',
						type=str,
						metavar='path',
						required=False,
						help='Set new style name')

arg_parser.add_argument('--report-names', '-r',
						action='store_true',
						required=False,
						help='Report font names and nametables')

arg_parser.add_argument('--dump-names', '-d',
						action='store_true',
						required=False,
						help='Dump font names and nametables')

for param, data in lookup_dict.items():
	arg_parser.add_argument('--{}'.format(param),
							type=str,
							metavar='str',
							required=False,
							help='Set font {} {} value'.format(data[0].upper(), param))	

arg_parser.add_argument('--version', '-v',
						action="version",
						version='{} | {} | VER. {}'.format(tool_name, tool_description, __version__),
						help='Show tool version.')

args = arg_parser.parse_args()

# -- Paths and configuration
font_file = args.File
work_path = args.output_path if args.output_path is not None else os.path.split(font_file)[0]

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
font_save_path = os.path.join(work_path, font_filename)

font_names_data_dump = font_names_data.dump()
changes_made = False

# - Process
if args.report_names:
	report_string = '{deco}\nFont:\t{font}\n{deco}\n{metric}\n'.format(deco='-'*40, font=font_filename, metric='\n'.join(['{}\t{} : {}'.format(lookup_dict[item[0]],item[0],item[1]) for item in font_names_data_dump]))
	print(report_string)

elif args.dump_names:
	font_names_data_dump_filename = os.path.join(work_path, os.path.splitext(font_filename)[0] + '-names-dump.json')
	with open(font_names_data_dump_filename, 'w') as json_tree:
		json_tree.write(json.dumps(font_names_data_dump))
	
	_output(0,'Saved font names dump: {}'.format(font_names_data_dump_filename))
	
else:
	for param, loc in lookup_dict.items():
		new_parameter_value = getattr(args, param)
		
		if new_parameter_value is not None:
			font_names_data[param] = new_parameter_value
			changes_made = True
			_output(0,'Font: {} Changed: {} to {}'.format(font_save_path, param, new_parameter_value))

# - Save changes
if changes_made:
	font_names_data.save(font_save_path)
	_output(0,'Saved Font: {}'.format(font_save_path))




	

