;; SCRIPT: 	FontRig: fr-gs-kern-clean
;; NOTE: 	Clean kerning values withing given range - Glyphs app font format
;; -----------------------------------------------------------
;; (C) Vassil Kateliev, 2021 		(http://www.kateliev.com)
;;------------------------------------------------------------

;; No warranties. By using this you agree
;; that you use it at your own risk!

;; - Dependancies -------------------------
(ns clj-parse-glyphs.core
	(:require 	[clojure.java.io :as io] 
				[clojure.walk])
				;[clojure.tools.cli :refer [parse-opts]])
	(:import (com.dd.plist NSArray NSDictionary NSNumber NSString PropertyListParser)))


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

(defn value-below [data filter-value]
	(let [[k v] data]
	(when-not (and (string? v) (< (Integer/parseInt v) filter-value)) [k v])))

(defn read-plist [^String source]
	(nsobject->object
		(PropertyListParser/parse source)))

;; -- Main --------------------------------
;; - Init
;;(def src-file "d:\\test.glyphs")

(defn -main [& args]
	(prn (format "Parsing file: %s" src-file))
  	
  	;; - Parse glyphs file
	(def gs-font-source (read-plist src-file))

	;; - Process
	;(remove-kern-value-cond (gs-font-source "kerning") (fn [x] (value-below x 5)))

  )