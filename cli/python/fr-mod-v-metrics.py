# SCRIPT: 	FontRig: fr-mod-v-metrics
# NOTE: 	Modify the vertical metrics of a *.ttf or *.otf file
# -----------------------------------------------------------
# (C) Vassil Kateliev, 2021 		(http://www.kateliev.com)
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
__version__ = 1.5

tool_name = 'FR-MOD-V-METRICS'
tool_description = 'FontRig | Modify the vertical metrics of a *.ttf or *.otf file'

# -- Configuration
lookup_dict = {	'sTypoAscender':'OS/2',
				'sTypoDescender':'OS/2',
				'usWinAscent':'OS/2',
				'usWinDescent':'OS/2',
				'sTypoLineGap':'OS/2',
				'sxHeight':'OS/2',
				'sCapHeight':'OS/2',
				'ascent':'hhea',
				'descent':'hhea',
				'lineGap':'hhea',
				'yMax':'head',
				'yMin':'head',
				'unitsPerEm':'head'
			}

# - Helpers -------------------------------------
def _output(i, message):
	msg_type = ['DONE', 'WARN', 'INFO', 'ERROR']
	print('{}:\t{}.'.format(msg_type[i], message))

# - Clases --------------------------------------
class FRfontMetrics(object):
	# TODO: Add Adobe and Microsoft strategies as procedures
	# https://glyphsapp.com/learn/vertical-metrics
	
	def __init__(self, file_path):
		self.file_path = file_path
		self.font = ttLib.TTFont(self.file_path)
	
	# - Internals
	def __getitem__(self, item):
		if item in lookup_dict.keys():
			return getattr(self.font[lookup_dict[item]], item)
		
	def __setitem__(self, item, value):
		if item in lookup_dict.keys():
			return setattr(self.font[lookup_dict[item]], item, value)

	# - Procedures 
	def save(self, output_path=None):
		output_path = self.file_path if output_path is None else output_path
		self.font.save(output_path)
	
	def dump(self):
		return [(item, self[item]) for item in lookup_dict.keys()]

	def fromDict(self, metrics_dict:dict):
		for item, value in metrics_dict.items():
			self[item] = value

# -- Setup CLI
arg_parser = argparse.ArgumentParser(prog=tool_name, description=tool_description)

arg_parser.add_argument('File',
						type=str,
						metavar='font file(s)',
						help='A *.ttf or *.otf font file(s)')
						

arg_parser.add_argument('--output-path', '-o',
						type=str,
						metavar='path',
						required=False,
						help='Optional output folder')

arg_parser.add_argument('--input-metrics', '-m',
						type=str,
						metavar='path',
						required=False,
						help='Vertical metrics config file in *.JSON format')

arg_parser.add_argument('--report-metrics', '-r',
						action='store_true',
						required=False,
						help='Report file metrics')

arg_parser.add_argument('--dump-metrics', '-d',
						action='store_true',
						required=False,
						help='Dump file metrics in *.JSON format')

for param, loc in lookup_dict.items():
	arg_parser.add_argument('--{}'.format(param),
							type=int,
							metavar='int',
							required=False,
							help='Set font {} {} value'.format(loc.upper(), param))	

arg_parser.add_argument('--version', '-v',
						action="version",
						version='{} | {} | VER. {}'.format(tool_name, tool_description, __version__),
						help='Show tool version.')

args = arg_parser.parse_args()

# -- Paths and configuration
font_files = glob.glob(args.File)
work_path = args.output_path if args.output_path is not None else os.path.split(font_files[0])[0]

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
for work_file in font_files:
	font_metrics = FRfontMetrics(work_file)
	font_filename = os.path.split(work_file)[1]
	font_save_path = os.path.join(work_path, font_filename)
	
	font_metrics_dump = font_metrics.dump()
	changes_made = False
	
	# - Process
	if args.report_metrics:
		report_string = '{deco}\nFont:\t{font}\n{deco}\n{metric}\n'.format(deco='-'*40, font=font_filename, metric='\n'.join(['{}\t{} : {}'.format(lookup_dict[item[0]],item[0],item[1]) for item in font_metrics_dump]))
		print(report_string)
		continue
	
	elif args.dump_metrics:
		font_metrics_dump_filename = os.path.join(work_path, os.path.splitext(font_filename)[0] + '-metrics-dump.json')
		with open(font_metrics_dump_filename, 'w') as json_tree:
			json_tree.write(json.dumps(font_metrics_dump))
		
		_output(0,'Saved font metrics dump: {}'.format(font_metrics_dump_filename))
		continue
	
	elif args.input_metrics is not None: 
		input_metrics = None

		with open(args.input_metrics, 'r') as json_tree:
			input_metrics = json.load(json_tree)

		_output(0,'Loaded font metrics: {}'.format(args.input_metrics))
		font_metrics.fromDict(dict(input_metrics))
		changes_made = True
		
	else:
		for param, loc in lookup_dict.items():
			new_parameter_value = getattr(args, param)
			
			if new_parameter_value is not None:
				font_metrics[param] = new_parameter_value
				changes_made = True
				_output(0,'Font: {} Changed: {} to {}'.format(font_filename, param, new_parameter_value))

	# - Save changes
	if changes_made:
		font_metrics.save(font_save_path)
		_output(0,'Saved Font: {}'.format(font_filename))




	

