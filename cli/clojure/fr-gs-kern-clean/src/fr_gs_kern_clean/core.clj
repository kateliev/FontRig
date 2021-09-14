;; SCRIPT: 	FontRig: fr-gs-kern-clean
;; NOTE: 	Clean kerning values withing given range - Glyphs app font format
;; -----------------------------------------------------------
;; (C) Vassil Kateliev, 2021 		(http://www.kateliev.com)
;;------------------------------------------------------------

;; No warranties. By using this you agree
;; that you use it at your own risk!

;; - Dependancies -------------------------
(ns fr-gs-kern-clean.core
	(:require 	[clojure.java.io :as io] 
				[clojure.walk]
				[clojure.tools.cli :refer [parse-opts]]
				[clojure.string :as str])
	(:import (com.dd.plist NSArray NSDictionary NSNumber NSString PropertyListParser)))

;; - Init ------------------------------
(def application {:name "fr-gs-kern-clean" :version "1.3"})

;; -- CLI Configuration 
(def cli-options
  ;; An option with a required argument
  [["-le" "--less-than value" "Kerning Value"
	:default 0
	:parse-fn #(Integer/parseInt %)]

	["-ge" "--greater-than value" "Kerning Value"
	:default 0
	:parse-fn #(Integer/parseInt %)]
   
 ;; A boolean option defaulting to nil
 ["-h" "--help"]])

;; - Objects -----------------------------
;; -- Glyphs parser ----------------------
(defmulti ^:private nsobject->object class)

(defmethod nsobject->object NSNumber [^NSNumber obj]
	(cond 	(.isBoolean obj) (.boolValue obj)
			(.isInteger obj) (.longValue obj)
			:else (.doubleValue obj)))

(defmethod nsobject->object NSString [^NSString obj]
	(.getContent obj))

(defmethod nsobject->object NSArray [^NSArray obj]
	(map nsobject->object (.getArray obj)))

(defmethod nsobject->object NSDictionary [^NSDictionary obj]
	(into {}
		(map (fn [^"java.util.LinkedHashMap$Entry" e]
			[(.getKey e) (nsobject->object (.getValue e))])
			(.. obj getHashMap entrySet))))

;; - Functions ----------------------------
(defn remove-kern-value-cond [gs-font-kerning cond-function]
	(clojure.walk/postwalk #(if (map? %) (into {} (map cond-function %)) %) gs-font-kerning))

(defn value-check [data filter-below filter-above]
	(let [[k v] data]
	(when-not (and (string? v) 
					(or (> filter-above (Integer/parseInt v) 0)
									(< 0 (Integer/parseInt v) filter-below)))
					[k v])))

(defn rename-file [filename]
	(let [filename-split (str/split filename #"\.")]
		(str/join "." (concat (drop-last filename-split) ["new"] [(last filename-split)]))))

(defn read-plist [^String source-file]
	(nsobject->object
		(PropertyListParser/parse source-file)))

(defn write-plist [object destination-file]
	(PropertyListParser/saveAsASCII object (io/file destination-file)))

;; -- Main --------------------------------
(defn -main [& args]
	(def cli-options (parse-opts args cli-options))
	(def src-file (first (cli-options :arguments)))
	;(println cli-options)

	;; - Parse glyphs file
	(if (.exists (io/file src-file))
		((println (format "Processing file: %s" src-file))
		
		;; - Parse file
		(def gs-font-source (read-plist src-file))
		
		;; - Process
		(def new-kerning 
				(remove-kern-value-cond 
						(gs-font-source "kerning") 
								(fn [x] (value-check x ((cli-options :options) :less-than) ((cli-options :options) :greater-than)))))
		
		(assoc gs-font-source :kerning new-kerning)
		(println (type gs-font-source))
		(write-plist gs-font-source (rename-file src-file)))

		(println (format "%s : Please specify a valid input file and options..." (clojure.string/join " " (vals application))))))