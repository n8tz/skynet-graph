/**
 * Copyright (C) 2021  Nathanael Braun
 
 * @author Nathanael BRAUN
 *
 * Date: 14/01/2016
 * Time: 09:32
 */
import TaskFlow from "taskflows";
import Node     from "./objects/Node";
import Segment  from "./objects/Segment";
import PathMap  from "./objects/PathMap";
import Concept  from "./objects/Concept";
import Entity   from "./objects/Entity";
//import conceptMap from "../concepts";

var isObject    = require('is').object;
var isArray     = require('is').array;
var isFunction  = require('is').fn;
var isString    = require('is').string;
var shortid     = require('shortid');
var dmerge      = require('deepmerge');
var intersect   = require('intersect');
var arrayDiffer = require('array-differ')
	, debug     = console;

/**
 * serialized format :
 * {
 *  spatialEP : (nodeid)
 *  conceptMaps : [
 *  // ... any serialized concept box (nodes/edge or docs) not serialized  
 *  ],
 *  // or
 *  nodes : [
 *  {
 *  _id : ...
 *  ConceptKey1 : true,
 *  ConceptKey2 : true,//...
 *  }
 *  ]
 *  segments : [
 *  {
 *  _id : ...
 *  originNode : {node _id}
 *  targetNode : {node _id}
 *  }
 *  ]
 *  ]
 * }
 *
 *
 * templates format :
 *  example  : from adding Airports
 [
 {// **************** add start to airport segment
   "Segment": true,
   "$originNode": "_parent:originNode",

   "targetNode": "nearbyOriginAirport"
 },
 {
   // **************** add nearby origin airport concept node
   "_id": "nearbyOriginAirport",
   "Node": true,
   "isAirport": true,
   "$nearTo": "_parent:originNode"// ref a value or cbox
 },
 {
   // **************** add long travel flight segment
   "Segment": true,
   "$_id": "_parent", // add concepts/keys to _parent, if no $_id -> original object will be kept
   "LongTravel": true,//
   "Distance":null,// should recalculate distance as soon as nearby airport have Position
   "originNode": "nearbyOriginAirport",
   "targetNode": "nearbyTargetAirport"
 },
 {
   // **************** add nearby target airport concept node
   "_id": "nearbyTargetAirport",
   "Node": true,
   "isAirport": true,
   "$nearTo": "_parent:targetNode"
 },
 {
   // **************** add final nearby target airport TO target place
   "Segment": true,
   "originNode": "nearbyTargetAirport",
   "$targetNode": "_parent:targetNode"
 }
 ]
 
 */
function Graph() {
	this.init(...arguments);
};

//Graph._providers = require("../providers");

Graph.PathMap = PathMap;
Graph.Entity  = Entity;
Graph.Concept = Concept;

Graph.prototype = {
	static: Graph,
	cfg   : {
		label         : "graph",
		autoMount     : true,
		isMaster      : true,
		onStabilize   : undefined, // should trigger synchronisation between graphs
		conceptSets   : ["common"],
		defaultContext: "UserRecord",
		bagRefManagers: {
			caipi: {
				test: /^db\:(.+)$/,
				int : {
					get( refId, cb ) {
						refId = refId.split('#');
						//debug.beep(refId)
						require('App/db').get(refId[0], refId[1], cb);
					}
				}
			}
		}
	},
	/**
	 *
	 * @param serialized
	 * @param conf
	 */
	init: function ( record, conf, conceptMap ) {
		var concepts = {}, me = this,
		    serialized;
		if ( isString(record.graph) ) {
			serialized = JSON.parse(record.graph);
		}
		else {
			serialized = record;
			record     = {
				lastRev: serialized.lastRev,
				graph  : JSON.stringify(record),
				//bagRefs: {}
			}
		}
		
		this._triggeredCast = {};
		this.cfg            = { ...this.cfg, ...conf };
		this.cfg.conceptSets.map(( k ) => concepts = dmerge(concepts, conceptMap[k]));
		me._conceptLib     = {};
		me._syncTokens     = {};
		me._syncTokensList = [];
		
		this._lastSyncRecord = record;
		
		this._rootConcept      = new Concept(concepts, me);
		this._mapsByConcept    = {};
		this._statsByProvider  = {};
		this._bagRefsByRefId   = {};
		this._on               = {};
		this._revs             = [];
		this._revByIds         = {};
		this._rev              = serialized.lastRev || 0;
		me._triggeredCastCount = 0;
		// TaskFlow (will handle all the graph tasks/mutations)
		// debug.warn("graph start !!!!!");
		
		this._taskFlow = new TaskFlow(
			[
				require('./tasks/stabilize')
			],
			this
		).then(this._loopTF);
		this._preloadBagRefs(
			serialized.bagRefs || {},
			() => {
				serialized && this.mount(serialized);
				
				if ( this.cfg.autoMount ) {
					this._taskFlow.run();
					me._running = true;
				}
				else {
					setTimeout(this._applyStabilized.bind(this));
				}
			}
		);
	},
	/**
	 *
	 * @param newRefs {"$db:id_from_somwhere":{count:1}}
	 * @param cb
	 * @private
	 */
	_preloadBagRefs( newRefs, cb ) {
		// internal : {"$db:id_from_somwhere":{count:1, lastUpdated:tm, watch:tm, record}}
		let refsMap = this._bagRefsByRefId,
		    mngrs   = this.cfg.bagRefManagers,
		    running = 1,
		    tm,
		    refs    = Object.keys(newRefs),
		    check   = () => {
			    debug.warn("timeout Preloading refs", newRefs);
			    tm = setTimeout(check, 5000);
		    },
		    done    = () => {
			    if ( !--running ) {
				    //refs.length && debug.log("done Preloading refs", refs);
				    clearTimeout(tm)
				    //this._taskFlow.release()
				    cb()
			    }
		    };
		//this._taskFlow.wait()
		tm          = setTimeout(check, 5000);
		//refs.length && debug.log("Preloading ", refs);
		refs.forEach(
			id => {
				let refMngrId = id && this._isBagRefs(id), v;
				if ( refMngrId && !refsMap[id] ) {
					v = ('' + id).match(mngrs[refMngrId].test)
					//refsMap[id] = refsMap[id] || {
					//    count: 0
					//};
					running++;
					mngrs[refMngrId].int.get(
						v[1] || id,
						( e, r ) => {
							if ( e )
								console.error("Graph can't retrieve bagRef ", id);
							refsMap[id] = refsMap[id] || {
								count: 0
							};
							refsMap[id].count++;
							refsMap[id].lastUpdated = Date.now();
							refsMap[id].record      = r || { name: "Error" };
							//console.log("Got record " + JSON.stringify( r ) );
							done()
						}
					)
				}
			}
		)
		
		done();
	},
	_isBagRefs( id ) {
		let refsMap = this._bagRefsByRefId,
		    mngrs   = this.cfg.bagRefManagers,
		    mKeys   = Object.keys(mngrs);
		for ( var i = 0, v; i < mKeys.length; i++ ) {
			//console.warn(mKeys[i], mngrs[mKeys[i]])
			
			v = ('' + id).match(mngrs[mKeys[i]].test)
			if ( v ) {
				return mKeys[i]
			}
		}
		return false;
	},
	// -------------------------------------------------------------------------- core
	
	/**
	 * Make the stabilisation taskflow loop until theres no more unstable items
	 * @param me
	 * @param flow
	 * @private
	 */
	_loopTF   : function ( me, flow ) {
		//debugger;
		if ( me._dead ) return;
		// flow.running=false;
		
		
		// debug.info("loop %s (%s / %s) ? ", me.cfg.label, me._unstable.length, me._triggeredCastCount);
		// me._running = me.cfg.autoMount;
		setTimeout(function () {// loop
			if ( me._dead ) return;
			
			flow.reset();
			debug.info("loop %s (%s / %s) !! ", me.cfg.label, me._unstable.length, me._triggeredCastCount);
			flow.then(me._loopTF);
			// me.cfg.autoMount &&
			(me._triggeredCastCount || me._unstable.length) && flow.run();
		});
		if ( !me._unstable.length && !me._triggeredCastCount ) {
			
			debug.log("end loop %s !! ", me.cfg.label);
			me._applyStabilized();
		}
	},
	printStats: function () {
		let stats = this._statsByProvider;
		if ( !stats )
			return;
		let total   = 0,
		    parts   = {},
		    results = Object.keys(stats)
		                    .sort(( a, b ) => (stats[b] - stats[a]))
		                    .map(( a ) => {
			                    total += stats[a];
			                    return a
		                    })
		                    .map(( a, i ) => {
			                    let insec = stats[a] / 1000,
			                        pct   = stats[a] * 100 / total;
			                    pct       = Math.round(pct * 1000) / 1000;
			                    insec     = Math.round(insec * 10) / 10;
			                    return "\t" + (pct) + "%\t" + "( ~ " + (insec) + "s )\t:\t" + a;
		                    }).join("\n");
		debug.warn(
			"____________________________________________________")
		debug.warn(
			"%s : Graph providers outer-stats total execTm [ %d s ] \n", this.cfg.label, ~~(total / 1000), results);
		debug.warn(
			"____________________________________________________")
	},
	/**
	 * get a serialized json copy of the graph
	 * @returns {{spatialEP: (*|string), servicesEP: *, timeStepEP: *, lastSpecified: (*|string), conceptMaps: Array}}
	 */
	serialize: function () {
		var state = this._lastSyncState,
		    map   = this._objById;
		return {
			...this._lastSyncRecord,
			lastRev: this.getCurrentRevision(),
			graph  : JSON.stringify(
				{
					spatialEP  : state.spatialEP,
					lastRev    : this.getCurrentRevision(),
					conceptMaps: Object.keys(this._objById).map(
						function ( id ) {
							return { ...map[id]._etty._ };
						}
					),
					bagRefs    : Object.keys(this._bagRefsByRefId).reduce(
						( r, id ) => {
							r[id] = {
								count: this._bagRefsByRefId[id].count
							}
							return r;
						}, {}
					),
					
				}
			)
		}
	},
	/**
	 * Do mount the graph (instantiate all objects & mark them as unstable)
	 * @param sg  serialized graph
	 */
	mount : function ( sg, cfg ) {
		var me = this, stack = [];
		
		// copy original state
		
		this._lastSyncState = sg = { ...sg };
		this._triggeredCast = {};
		// clean up / init ...
		// user & datas open request
		this._userQuery = [];
		this._dataQuery = [];
		
		this._rev                  = sg.lastRev || 1;
		this._history              = [];
		this._unstable             = [];
		this._pending              = [];
		this._stable               = [];
		this._objById              = {};
		this._pendingMutationsById = {};
		sg.freeNodes               = sg.freeNodes || [];
		sg.nodes                   = sg.nodes || [];
		sg.segments                = sg.segments || [];
		if ( sg.conceptMaps ) {
			sg.conceptMaps.map(
				function ( map ) {
					if ( !map ) return debug.warn(sg.conceptMaps);
					if ( map.Node ) sg.nodes.push(map);
					else if ( map.Segment ) sg.segments.push(map);
					else sg.freeNodes.push(map);
				}
			);
		}
		
		this._freeNodes = sg.freeNodes// free nodes are concept map / scope, linkable on node's & segment's conceptMap, on which we can cast
			// concepts,
			&& sg.freeNodes.map(function ( v ) {
				me._objById[v._id] = { _etty: new Entity(v, me) };
				me._unstable.push(me._objById[v._id]) || me._stable.push(me._objById[v._id]);
				me._objById[v._id]._etty.updateApplicableConcepts(me);
				
				
				return me._objById[v._id];
			})
			|| [];
		this._nodes     = sg.nodes// nodes first as segments autoregister them in nodes
			&& sg.nodes.map(function ( v ) {
				me._objById[v._id] = new Node(v, me);
				// me.cfg.autoMount &&
				me._unstable.push(me._objById[v._id]) || me._stable.push(me._objById[v._id]);
				me._objById[v._id]._etty.updateApplicableConcepts(me);
				
				return me._objById[v._id];
			})
			|| [];
		this._segments  = sg.segments
			&& sg.segments.map(function ( v ) {
				me._objById[v._id] = new Segment(v, me);
				// me.cfg.autoMount &&
				me._unstable.push(me._objById[v._id]) || me._stable.push(me._objById[v._id]);
				me._objById[v._id]._etty.updateApplicableConcepts(me);
				return me._objById[v._id];
			})
			|| [];
		debug.warn("graph mounted !!!!!");
		
	},
	refMap: {},//@todo same refs from same nodes should overwrite listeners when updating sub ref
	/**
	 *
	 * Will walk in scopes to get some value or to put a watcher
	 *
	 * @param exp
	 * @param scope
	 * @param follow [bool|fn] do unstabilize scope's object if the concept asked is not here
	 *                    (so it will warn object that the stuff it ask is now here)
	 * @returns {targeted value}
	 */
	getRef: function ( exp, scope, follow, unref, getBox ) {
		let cScope = isString(scope) && this.getEtty(scope) || scope || this.getEtty(this.cfg.defaultContext),
		    refId  = cScope && cScope._ && (cScope._._id + '::' + exp),
		    keyRefId,
		    refStack;
		
		getBox = getBox || this.getEtty.bind(this);
		
		exp    = exp.split('.');
		follow = follow === true && scope._._id || follow;
		
		
		let refs = this.refMap[refId] = follow && !unref && this.refMap[refId] || [], bagRef;
		
		while ( exp.length ) {
			if ( exp[0].indexOf(':') != -1 ) {// follow the ref
				exp[0] = exp[0].split(':');
				
				while ( exp[0].length != 1 ) {//@todo
					
					if ( exp[0][0][0] == '$' ) {// global ref
						cScope = getBox(exp[0][0].substr(1));// switch scope
						exp[0].shift();
					}
					else {
						keyRefId = cScope.get && cScope.get(exp[0][0], follow, unref) || cScope[exp[0][0]];// walk
						//
						bagRef = this._isBagRefs(keyRefId)
						
						if ( bagRef ) // this an out ref
						{
							if ( !this._bagRefsByRefId[keyRefId] )
								debug.warn("Graph : do ref an unknow bagRef " + keyRefId, cScope)
							cScope = this._bagRefsByRefId[keyRefId] && this._bagRefsByRefId[keyRefId].record || null;
						}
						else {
							// if (!exp[0][1] && exp.length == 1)// someKey:  (get the target value)
							// {
							//     cScope = sw;
							//     continue;
							// }
							//if ( keyRefId && !getBox(keyRefId) ) debugger;
							
							if ( follow && !unref && refs[exp.length] && (refs[exp.length] != keyRefId) )
								getBox(refs[exp.length]) &&
								getBox(refs[exp.length])._etty.get(exp[0][0], follow, true);
							
							// refs[exp.length] = sw;
							cScope = getBox(keyRefId);// walk
						}
						exp[0].shift();
						
					}
					if ( !cScope ) return;
				}
				if ( !exp[0][0] ) {
					return cScope;// exp finishig by : ex: "originNode:"
				}
				exp[0] = exp[0][0];
			}
			if ( exp[0][0] == '$' ) {// global ref
				if ( exp.length == 1 )
					return this._objById[exp[0].substr(1)] && this._objById[exp[0].substr(1)]._etty._._id;
				cScope = this._objById[exp[0].substr(1)] && this._objById[exp[0].substr(1)]._etty;
			}
			else if ( exp.length == 1 ) {
				return cScope.get ? cScope.get(exp[0], follow, unref) : cScope[exp[0]];
				
			}
			else if ( exp.length ) {
				cScope = cScope.get ? cScope.get(exp[0], follow, unref) : cScope[exp[0]];
			}
			if ( !cScope ) return;
			exp.shift();
		}
		return cScope;
	},
	
	update: function ( record ) {
		var cRecord = this._lastSyncRecord,
		    changes = Object.keys(record).map(( b ) => ((record[b] != cRecord[b]) && b)).filter(
			    i => !!i || ["graph", "updated"].includes(i)
		    );
		// debugger;
		
		if ( !changes.length || (changes.length == 1) && changes[0] == "updated" ) {
			
			return;// no changes
		}
		else {
			debug.error(changes);
			if ( this._rev <= record.lastRev ) {
				
				this._revs[this._rev] = {
					id          : shortid.generate(),
					recordUpdate: record
				};
				record.lastRev++;
				this._rev++;
				// this.stabilize();
				
				
			}
			
			this._lastSyncRecord = {
				...this._lastSyncRecord,
				...record
			};
		}
	},
	
	// -------------------------------------------------------------------------- atomic stuff
	
	getCurrentRevision: function () {
		return this._rev;
	},
	/**
	 * get all atoms from from to to
	 * @param from
	 * @param to
	 * @returns {Array.<T>}
	 */
	getRevisionsRange: function ( from, to ) {
		debug.log(" getRevisionsRange", from, to);
		
		return this._revs.slice(from, to);
	},
	
	
	_mutationThread       : [],
	_mutationThreadRunning: false,
	_atomicThread         : [],
	_atomicThreadRunning  : false,
	/**
	 * Push atoms from remote or client
	 * @param from
	 * @param to
	 * @param atoms
	 * @param token
	 * @param resetRevs
	 */
	pushAtomicUpdates: function ( from, to, atoms, token, resetRevs ) {
		// !__SERVER__ &&
		var me      = this,
		    i       = 0,
		    max     = to - from,
		    allRefs = {};
		//
		//if ( this._atomicThreadRunning ) {
		//    debug.warn('Delay RT Update request:', from, to);
		//
		//    return this._atomicThread.push([...arguments]);
		//}
		//this._atomicThreadRunning = true;
		debug.warn('RT Update request:', from, to, token, !__SERVER__ && atoms);
		//while ( i < max ) {
		//    atoms[i]
		//    && atoms[i].bagRefs
		//    && atoms[i].bagRefs.length
		//    && atoms[i].bagRefs.each(id => {
		//        allRefs[id] = allRefs[id] || { count: 0 };
		//        allRefs[id].count++;
		//    });
		//    i++;
		//}
		//this._preloadBagRefs(
		//    allRefs,
		//    () => {
		// me._inited = true;
		while ( i < max ) {
			atoms[i]
			//&& !this._revByIds[atoms[i].id]//@todo: alpha method...
			&& this.pushMutation(atoms[i].tpl, atoms[i].parent, true, atoms[i].id, atoms[i].bagRefs), i++;
		}
		token = isArray(token) ? token : token && [token] || [];
		// debugger;
		// token && this.on("stabilize", function fn() {// sync cb
		//     me.un("stabilize", fn);
		//     debugger;
		//
		// });
		// if ( this.cfg.autoMount ) {
		if ( !this._taskFlow.running ) {
			this._taskFlow.run();
		}
		me._running = true;
		token.map(( t ) => me._syncTokensList.push(t));
		// } else this._applyStabilized();
		
		token.map(( t ) => me._syncTokens[t] && me._syncTokens[t]());
		this.stabilize(
			//r=>{
			//
			//}
		);
		
		this._on.atomicUpdate
		&& this._on.atomicUpdate.map(( cb ) => cb(me, from, to, atoms));
		this.cfg.onAtomicUpdate
		&& this.cfg.onAtomicUpdate(this, from, to, atoms);
		//this._atomicThreadRunning = false;
		//
		//if ( this._atomicThread.length ) {
		//    this.pushAtomicUpdates(...this._atomicThread.shift())
		//}
		//}
		//)
		
	},
	
	// -------------------------------------------------------------------------- mutations stuff
	
	/**
	 *
	 * @param path
	 * @param mapLib
	 * @param tSegment
	 */
	pushMutationFromPath: function ( path, descrs, tSegment ) {
		this.pushMutation(this.getMutationFromPath(path, descrs, tSegment), tSegment)
	},
	/**
	 * convert a path to a graph template
	 * @param path
	 * @param mapLib
	 * @param tSegment
	 * @returns {Array}
	 */
	getMutationFromPath: function ( path, descrs, tSegment ) {
		var
			me  = this,
			tpl = path.slice(0);
		tpl.unshift.apply(tpl, descrs);//?
		tpl = tpl.map(
			function ( cmap ) {
				cmap = { ...cmap };
				if ( cmap.__bagRefKeys ) {
					cmap.__bagRefKeys.forEach(
						key => {
							if ( cmap[key] )
								cmap['$$' + key] = cmap[key];
							delete cmap[key];
						}
					)
					delete cmap.__bagRefKeys;
				}
				// if ( cmap.TimePeriod ) {// periods from the vendor record
				//     Period.start = Math.min(Period.start, cmap.TimePeriod.start);
				//     Period.end   = Math.max(Period.end, cmap.TimePeriod.end);
				// }
				// if ( (related = cmap.pathDescriptor) && mapLib[related] ) {
				//     do {
				//         if ( !relatedRefs[related] ) {
				//             relatedRefs[related] = merge(true, mapLib[related]);
				//             relatedTpl.push(relatedRefs[related]);
				//         }
				//     } while (related = mapLib[related] && mapLib[related].parentPathDescriptor)
				// }
				if ( cmap._rev )
					delete cmap._rev;
				// if ( me._objById[cmap._id] ) {// existing turn to ref
				//
				//     // if (cmap._id==)
				//
				//     cmap.$_id = '$' + cmap._id + '._id';
				//     delete cmap._id;
				//
				// }
				return cmap;
			}
		);
		return tpl;
	},
	/**
	 * Manual/forced concept uncast
	 * @param cmapId the target cmap id
	 * @param cId the concept id
	 * @param cb
	 */
	unCastConcept: function ( cmapId, cId, cb ) {
		if ( this._objById[cmapId]._etty._._autokill ) return;
		var me = this, key = cmapId + '/' + cId;
		if ( this._triggeredCast[key] )
			delete this._triggeredCast[key];
		// debug.warn("---------------- UnCast", cId);
		this.pushMutation(
			{
				$_id                         : "_parent",
				[this._conceptLib[cId]._name]: null
			},
			cmapId
		);
		// this._objById[cmapId]._etty.unCast(this._conceptLib[cId]._name, null);
		// this.toggleGraphObjectState(cmapId, "unstable");
		this.stabilize(cb);
	},
	/**
	 * Manual/forced concept cast
	 * @param cmapId the target cmap id
	 * @param cId the concept id
	 * @param cb
	 */
	castConcept   : function ( cmapId, cId, cb ) {
		if ( this._objById[cmapId]._etty._._autokill ) return;
		var me = this, key = cmapId + '/' + cId;
		// debug.warn("---------------- Cast", cmapId);
		// this._triggeredCast[key] = [cmapId, cId];
		// me._triggeredCastCount++;
		this._taskFlow.pushSubTask(
			this._conceptLib[cId].applyTo(this._objById[cmapId]._etty, this));
		this.toggleGraphObjectState(cmapId, "unstable");
		this.stabilize(cb);
	},
	pushAtomicData: function ( data, revFrom, token ) {
		var me = this;
		debug.log("Start pushing from client %j", revFrom);
		token = isArray(token) ? token : token && [token] || [];
		
		this.pushMutation(data.tpl, data.parent, true);
		token.map(( t ) => me._syncTokensList.push(t));
		// token && this.on("stabilize", function fn() {// sync cb
		//     me.un("stabilize", fn);
		//     token.map(( t )=>me._syncTokens[t] && me._syncTokens[t]());
		//
		// });
	},
	/**
	 * Apply a graph template, creating or updating existing objects
	 *
	 * (all updated objects will be destabilized)
	 *
	 * Must mark original object with the current revision number (original & theoric segments must be kept 4 history)
	 *
	 *
	 * @param template
	 * @param targetId
	 * @param keepRev
	 * @param atomId
	 */
	pushMutation: function ( template, targetId, force, atomId, initialRefBag, cb ) {
		//debug.log("Start pushing mutation %j", template);
		
		template           = isArray(template) ? template : [template];
		var me             = this,
		    cObject, cTargetObj,
		    push           = Array.prototype.push,
		    tid, refId, revId, revNum,
		    cTplObject,
		    revTpl         = [],
		    stack          = [],
		    pendingObjects = [],
		    pendingRefs    = [],
		    pendingRefMaps = [],
		    pendingERefs   = [],
		    refs           = {},
		    masterToken,
		    keepRev        = !this.cfg.isMaster,
		    originCMap     = targetId && me.getEtty(targetId) && me.getEtty(targetId)._ || false,
		    baseOrigin     = originCMap && originCMap._keepOrigin && originCMap._origin || false,
		    aliases        = ["_parent"],
		    refScope       = {
			    _parent: targetId
		    },
		    bagRefs        = initialRefBag ? { ...initialRefBag } : {};
		
		let refMap = {};
		if ( !force && !this.cfg.isMaster ) {
			debug.warn("pushing 2 master", targetId);
			// if (!me.cfg.isMaster && !me._inited){
			//     this._taskFlow.wait();
			//     debugger;
			//
			//     return me.on("atomicUpdate", function atomicUpdate() {
			//         me.un("atomicUpdate", atomicUpdate);
			//         me._inited=true;
			//         me.pushMutation.apply(me, arguments);
			//         me._taskFlow.release();
			//     });
			// }
			if ( !this._taskFlow.running ) {
				this._taskFlow.run();
			}
			this._running = true;
			me._taskFlow.wait();
			masterToken = this.cfg.pushToMaster(
				{
					baseRev: me._rev,
					parent : targetId,
					tpl    : template
				}
			);
			
			this._syncTokens[masterToken] = () => {// here the server should have applied this mutation & pushed back the resulting mutations
				me._taskFlow.release();
				debug.info('Complete %s !', masterToken);
				delete me._syncTokens[masterToken];
				cb && cb({ /* should have refscope here*/ })
			};
			debug.warn('RT Push request waiting ', masterToken);
			return;
		}
		
		if ( this._mutationThreadRunning ) {
			debug.warn('Delay mutation', this._mutationThread.length);
			
			return this._mutationThread.push([...arguments]);
		}
		this._mutationThreadRunning = true;
		
		//debug.warn('RT Update request:', from, to, token, !__SERVER__ && atoms);
		//while ( i < max ) {
		//    atoms[i]
		//    && atoms[i].bagRefs
		//    && atoms[i].bagRefs.length
		//    && atoms[i].bagRefs.each(id => {
		//        allRefs[id] = allRefs[id] || { count: 0 };
		//        allRefs[id].count++;
		//    });
		//    i++;
		//}
		
		push.apply(stack, template);
		
		// if ( !keepRev ) {
		revId = atomId || shortid.generate();
		// }
		
		// !keepRev &&
		revNum = this._rev;
		this._rev++;
		// !keepRev && push.bind(this._revs[this._rev].tpl, template);
		
		// parse objects...
		while ( cTplObject = stack.shift() ) {
			
			// create id & map innertpl ids
			refId = cTplObject.$_id && this.getRef(cTplObject.$_id, refScope,
			                                       null,
			                                       null,
			                                       // required to work when referencing inner tpl from graph items
			                                       ( id ) => {
				                                       return (refScope[id] || this.getEtty(id)) && {
					                                       get: ( key ) => (
						                                       refScope[id] && refScope[id].hasOwnProperty(key)
						                                       ? refScope[id][key]
						                                       : this.getEtty(id) && this.getEtty(id).get(key)
					                                       ),
				                                       }
			                                       });
			
			if ( refId && !isString(refId) )
				refId = refId._id;
			
			if ( cTplObject.$$_id ) {
				// debugger;
				refId = cTplObject.$$_id;
				if ( cTplObject.$$_id == cTplObject._id )
					delete cTplObject._id;
			}
			
			if ( !refId && cTplObject._id ) {
				if ( refs[cTplObject._id] ) {// if there was a previous tpl item with same ref
					// debugger;
					tid = refs[cTplObject._id];
				}
				else if ( this._objById[cTplObject._id] ) // keep id if no objects use it
					tid = refs[cTplObject._id] = refId || shortid.generate();// force it if refid = $(id) is specified
				else tid = refs[cTplObject._id] = cTplObject._id;
			}
			else if ( refId && cTplObject._id ) {
				tid = refs[cTplObject._id] = refId;
				aliases.push(cTplObject._id);
				refScope[cTplObject._id] = refId;
			}
			else
				tid = refId || shortid.generate(); // if the node inherit some other node keep his id
			
			// if ( keepRev && cTplObject._rev) {// update max rev
			//     this._rev = Math.max(this._rev, cTplObject._rev);
			// }
			
			if ( isString(refScope[tid]) ) {
				
				debugger;
			}
			
			// now create a pushable object
			cObject = refScope[tid] = refScope[tid] || { _id: tid, _rev: revNum };
			// if (!refScope[tid])
			//     refScope[tid] = cObject;
			
			
			Object.keys(cTplObject).forEach(
				function ( c ) {
					if ( c[0] == '$' ) {// auto ref/mount
						if ( /\$(_incoming|_outgoing|\$?_id)/.test(c) ) return;
						if ( c === "$$_refMap" ) {
							
							if ( me.cfg.isMaster ) {// only the master know the real ids
								pendingRefMaps.push([cTplObject, cTplObject[c], cObject]);
							}
							else {
								// clients keep the map
								// debugger
								// cObject._refMap = cTplObject._refMap;
							}
							return;
						}
						var key = c.substr(1);
						
						if ( c[1] == '$' && isString(cTplObject[c]) ) {// bagRef
							let bagMngr = cTplObject[c] && me._isBagRefs(cTplObject[c]);
							//debug.beep('...', c, cTplObject[c])
							if ( bagMngr ) {// if this is an out ref
								bagRefs[cTplObject[c]] = bagRefs[cTplObject[c]] || { count: 0 };
								bagRefs[cTplObject[c]].count++;
								cObject[c.substr(2)] = cTplObject[c];
								
								// keep ref keys to track them when importing paths
								cObject.__bagRefKeys = cObject.__bagRefKeys || [];
								
								!cObject.__bagRefKeys.includes(c.substr(2))
								&& cObject.__bagRefKeys.push(c.substr(2))
								//console.log("OUT REF : " + cTplObject[c] + " " + cTplObject[c] );
							}
							else // if its a string that's an internal ref
								console.error("No manager for ref ", c, cTplObject[c]);
						}
						else if ( isString(cTplObject[c]) ) {
							pendingERefs.push([key, cTplObject[c], cObject]);
						}
						else if ( isObject(cTplObject[c]) ) {
							// if this an object we must create the Node/Segment/whatever
							// @todo : object merge
							if ( cTplObject[c].$_id ) {
								cTplObject[c]._id = me.getRef(cTplObject[c].$_id, refScope);//@note : cant ref innertpl
							}
							if ( cTplObject[c].$$_id ) {
								cTplObject[c]._id = cTplObject[c].$$_id;//@note : cant ref innertpl
							}
							
							cTplObject[c]._id = cTplObject[c]._id || shortid.generate();
							
							pendingRefs.push([key, cTplObject[c]._id, cObject]);
							stack.push(cTplObject[c]);
						}
						
					}
					else {// simple copy
						if ( /(_incoming|_outgoing|\$?_id)/.test(c) ) return;
						if ( cTplObject[c] !== undefined )
							cObject[c] = cTplObject[c];
					}
				}
			);
			
			// push incomings...
			cTplObject._incoming
			&& stack.push.apply(stack, cTplObject._incoming);
			cTplObject._outgoing
			&& stack.push.apply(stack, cTplObject._outgoing);
		}
		this._taskFlow.wait();
		this._preloadBagRefs(
			bagRefs,
			() => {
				
				pendingRefs.map(function ( ref ) {
					ref[2][ref[0]] = ref[1];// apply inner references
				});
				pendingERefs.map(( ref ) => {
					if ( refs[ref[1]] ) {
						// local alias
						ref[2][ref[0]] = refs[ref[1]];
					}
					else {
						// if ( /_currentTask/.test(ref[1]) )
						// debugger;
						ref[2][ref[0]] = me.getRef(
							ref[1],
							refScope,
							null,
							null,
							// required to work when referencing inner tpl from graph items
							( id ) => {
								return (refScope[id] || this.getEtty(id)) && {
									get: ( key ) => (
										refScope[id] && refScope[id].hasOwnProperty(key) ? refScope[id][key]
										                                                 : this.getEtty(id) && this.getEtty(id).get(key)
									),
								}
							}
						)
						;// apply outer references
					}
				});
				// build ref map...
				if ( pendingRefMaps.length ) {
					// Object.keys(refScope).forEach(
					//     function ( id ) {
					//
					//         if ( aliases.includes(id) ) {
					//             refMap[id] = refScope[id];
					//             return null;
					//         }
					//         refMap[id] = refScope[id]._id;
					//     });
					
					pendingRefMaps.map(( ref ) => {
						if ( isString(ref[1]) ) {
							debug.error(me._objById[ref[2]._id] && me._objById[ref[2]._id]._etty._._refMap);
						}
						delete ref[0].$$_refMap;
						ref[2]._refMap = ref[0]._refMap =
							isString(ref[1]) ? {
									...(me._objById[ref[2]._id] && me._objById[ref[2]._id]._etty._._refMap || {}),
									[ref[1]]: { ...refs }
								}
							                 : isObject(ref[1]) ? { ...ref[1], ...refs }
							                                    : { ...refs } // reset with/false
					});
				}
				// we still need to instantiate them..
				Object.keys(refScope).forEach(
					function ( id ) {// 1st pass : the nodes
						
						if ( aliases.includes(id) ) {
							// refMap[id] = refScope[id];
							return null;
						}
						// refMap[id] = refScope[id]._id;
						
						
						if ( me._objById[id] ) {// if this is an existing node
							if ( me._objById[id]._etty._.Node ) {
								
								// do merge with existing
								me._objById[id]._etty.update(refScope[id], me);
								
								me.toggleGraphObjectState(id, "unstable");
								return me._objById[id];
							}
							else pendingObjects.push(id);
						}
						else {
							if ( refScope[id].Node ) {
								refScope[id]._origin = refScope[id]._origin || baseOrigin || targetId;
								me._objById[id]      =
									refScope[id].Node && new Node(refScope[id], me);
								
								
								me._nodes.push(me._objById[id]);
								me._unstable.push(me._objById[id]);
								return me._objById[id];
							}
							else pendingObjects.push(id);
						}
					}
				);
				//debugger;
				pendingObjects.map(
					function ( id ) {// 2nd pass : the segments (they will be auto linked to the nodes..)
						if ( refScope[id].targetNode == "initialTarget" )
							debugger;
						revTpl.push(refScope[id]);
						if ( me._objById[id] ) {// the segment/doc exist
							// do merge with existing
							me._objById[id]._etty.update(refScope[id], me);
							
							me.toggleGraphObjectState(id, "unstable");
							return me._objById[id];
						}
						else {
							if ( id.match(/debug/) ) debugger;
							if ( refScope[id].Segment ) {// create the segment
								
								refScope[id]._origin = refScope[id]._origin || baseOrigin || targetId;
								me._objById[id]      = new Segment(refScope[id], me);
								
								me._segments.push(me._objById[id]);
								me._unstable.push(me._objById[id]);
								// me.toggleGraphObjectState(id, "unstable");
								me._objById[id]._etty.updateApplicableConcepts(me);
								return me._objById[id];
							}
							else {// records/docs
								refScope[id]._origin = refScope[id]._origin || baseOrigin || targetId;
								me._objById[id]      = { _etty: new Entity(refScope[id], me) };
								
								me._segments.push(me._objById[id]);
								me._unstable.push(me._objById[id]);
								return me._objById[id];
							}
						}
					}
				);
				delete refScope._parent;
				
				
				this._revs[revNum] = {
					id    : revId,
					parent: targetId,
					bagRefs,
					tpl   : Object.keys(refScope).map(
						id => {
							if ( aliases.includes(id) ) {
								refMap[id] = refScope[id];
								return null;
							}
							refMap[id] = refScope[id]._id;
							let item   = { ...refScope[id] };
							
							item.$$_id = item._id;
							delete item._id;
							return item;
						}
					).filter(i => !!i)
				};
				this._on.mutation
				&& this._on.mutation.map(( cb ) => cb(me));
				this.cfg.onMutationApplied
				&& this.cfg.onMutationApplied(this);
				this._mutationThreadRunning = false;
				this._taskFlow.release();
				cb && cb(refScope)
				if ( this._mutationThread.length ) {
					this.pushMutation(...this._mutationThread.shift())
				}
				this.stabilize();
				
			}
		);
		//console.log("push done ", this._revs[this._rev - 1]);
		
		return refScope;
	},
	
	// -------------------------------------------------------------------------- control
	
	/**
	 * Launch a stabilisation on all unstable objects
	 * then call cb
	 * @param cb
	 */
	stabilize: function ( cb ) {
		var me = this;
		// debugger;
		cb && this.on("stabilize", function stabilize() {
			me.un("stabilize", stabilize);
			cb(arguments);
		});
		if ( !this._taskFlow.running ) {
			this._taskFlow.run();
		}
		this._running = true;
		
	},
	/**
	 * Call the sync method passed in the cfg (should send last atoms to the server/client)
	 * @param _cb
	 */
	sync: function ( _cb ) {
		var me    = this,
		    token = this.cfg.doSync
			    && this.cfg.doSync(this, _cb);
		debug.log('RT Push request:', token);
		
		if ( _cb && token ) {
			this._syncTokens[token] = _cb;
		}
		else _cb && _cb();
	},
	/**
	 * mk all object unstable
	 */
	destabilizeThemAll: function () {
		Object.keys(this._objById).map(( k ) => this.toggleGraphObjectState(k, 'unstable'), this);
	},
	/**
	 * Change some object State (dirty way..)
	 * @param id
	 * @param state
	 * @returns {boolean}
	 */
	toggleGraphObjectState: function ( id, state ) {
		var i,
		    out1, out2, in1,
		    obj = this._objById[id];
		
		if ( state == "stable" )
			out1 = this._pending,
				out2 = this._unstable,
				in1 = this._stable;
		else if ( state == "pending" )
			out1 = this._stable,
				out2 = this._unstable,
				in1 = this._pending;
		else if ( state == "unstable" )
			out1 = this._stable,
				out2 = this._pending,
				in1 = this._unstable;
		else
			return false;
		
		if ( (i = out1.indexOf(obj)) != -1 )
			out1.splice(i, 1);
		else if ( (i = out2.indexOf(obj)) != -1 )
			out2.splice(i, 1);
		else
			return false;
		
		in1.push(obj);
		return true;
	},
	
	// -------------------------------------------------------------------------- accessors
	
	/**
	 * get a resultpath (paths from getPaths) and return an PathMap object
	 * @param id
	 * @returns {*|null}
	 */
	getOpenPathOf     : function ( id ) {
		return this._objById[id]
			&& this._objById[id]._etty._.OpenPaths
			&& new PathMap(this._objById[id]._etty._.OpenPaths, this._objById[id]._etty);
	},
	removeObj         : function ( id, justClean ) {
		var obj = this._objById[id], i;
		i       = this._pending.indexOf(obj);
		(i != -1) && this._pending.splice(i, 1);
		i = this._unstable.indexOf(obj);
		(i != -1) && this._unstable.splice(i, 1);
		i = this._stable.indexOf(obj);
		(i != -1) && this._stable.splice(i, 1);
		delete this._objById[id];
		!justClean && obj._etty.destroy(true);
	},
	getConcept        : function ( id ) {
		return this._conceptLib[id];
	},
	getExtOpenConcepts: function ( id ) {
		if ( this._objById[id] ) {
			this._objById[id]._etty.updateApplicableConcepts();// update in case of ..
			return this._objById[id]._etty._extOpenConcepts;
		}
		return [];
	},
	
	pushPath: function ( path, edgeId, name, cb ) {
		
		var
			me                = this,
			scope             = this.getEtty(edgeId),
			// cmaps        = path._pmap.maps,
			getAllPropsInPath = PathMap.prototype.getAllPropsInPath,
			tm                = getAllPropsInPath(path, "TimePeriod"),
			originId          = getAllPropsInPath(path, ["_id", "isTravelStart"])[0],
			travelEnds        = getAllPropsInPath(path, ["_id", "isTravelEnd"]),
			targetId          = travelEnds[travelEnds.length - 1],
			pathId            = shortid.generate(),
			tpl               = path.tpl.map(( obj ) => ({ ...obj, pathId })),
			rpath,
			originSrc         = scope.getRef('originNode'),
			originTarget      = scope.getRef('targetNode'),
			tId               = tpl[1]._id,
			tId2              = tpl[tpl.length - 2]._id;//shortid.generate();
		
		// rm origin target & origin
		// tpl.shift();
		tpl.shift();
		tpl.pop();
		// tpl.pop();
		// tpl = tpl
		tpl[0].originNode              = scope._.originNode;
		tpl[tpl.length - 1].targetNode = scope._.targetNode;
		// debugger;
		//this.pushMutationFromPath(tpl, path.descr, edgeId);
		rpath = [
			...path.relatedTpl.map(
				( m ) => {
					return { ...m, $_id: '$' + m._id };// use the existing one if exist
				}
			),
			...this.getMutationFromPath(tpl, path.descr, edgeId),
			{
				$_id     : '$' + edgeId,
				OpenPaths: false,
				// Stay        : null,
				// Travel      : null,
				PathIgnore: !scope._.KeepInPath,// <- /!\ this will hide the segment in the debug graph and navline
			                                    // paths
				// targetNode  : originTarget,
				// originNode  : null,
				childPaths: {
					...(scope._.childPaths || {}),
					[name]: pathId
				},
				TimePeriod: null
			},
			{
				$_id        : "$UserRecord",
				loadingSteps: false,
				// cFocusedEdge : tId2,
				staysCount: me.selectMapsId(["Stay"], ["VendorStep"]).length
			}
		];
		// if (
		//     scope._.targetNode == "target" ||
		//     (scope.getRef("targetNode:Theoric") && edgeId !== "_root" && !scope.getRef("originNode:Theoric") )
		// ) {// root must move the initial seg
		console.log(rpath)
		// debugger;
		
		this.pushMutation(
			rpath,
			edgeId
		);
		// } else
		//     this.pushMutation(
		//         [
		//
		//             // {
		//             //     $_id    : '$' + tId,
		//             //     _origin : '_root',
		//             // },
		//             // {
		//             //     $_id        : '$' + tId2,
		//             //     "Undefined" : true,
		//             //     _origin     : '_root',
		//             //     // fxdhfgdgfhdgdg: targetId._id
		//             // },
		//             {
		//                 $_id        : '$' + edgeId,
		//                 OpenPaths : false,
		//                 // Stay        : null,
		//                 // Travel      : true,
		//                 // targetNode  : targetId._id,
		//                 Undefined   : false,
		//                 childPaths  : {
		//                     ...(scope._.childPaths || {}),
		//                     [name || pathId] : pathId
		//                 },
		//                 // TimePeriod  : null
		//             },
		//             {
		//                 $_id         : "$UserRecord",
		//                 loadingSteps : false,
		//                 cFocusedEdge : tId2,
		//                 staysCount   : me.selectMapsId(["Stay"], ["VendorStep"]).length
		//             }
		//         ],
		//         edgeId
		//     );
		// debugger;
		this.stabilize(() => {
			let newPath  = this.getChildPath(edgeId),
			    nextTheo = newPath.reduce(( r, item ) => (item._etty._.Undefined && item._etty._._id || r), edgeId);
			
			//   debugger
			
			cb && cb(nextTheo, newPath);
		});
	},
	/**
	 *
	 * @param origin
	 */
	getChildMatching: function ( edgeId, query ) {
		let newPath  = this.getChildPath(edgeId),
		    fn       = isFunction(query) ? query : new Function("scope",
		                                                        "try{" +
			                                                        "return (" +
			                                                        (
				                                                        (
					                                                        isArray(query)
					                                                        ? query.length && query.join(") && (")
					                                                        : query
				                                                        ).replace(/\$(\$?[a-zA-Z\_][\w\.\:\$]+)/ig, "scope.getRef(\"$1\")")
				                                                        || "false"
			                                                        )
			                                                        + ");" +
			                                                        "}catch(e){" +
			                                                        "return undefined;" +
			                                                        "}"
		    ),
		    nextTheo = newPath.filter(( item ) => fn(item._etty));
		
		return nextTheo
	},
	/**
	 *
	 * @param origin
	 */
	isTheoricChildOf: function ( cId, pId ) {
		let child   = this.getEtty(cId),
		    current = child;
		
		while ( current ) {
			if ( current._._id == pId )
				return true;
			
			current = this.getEtty(current._._origin);
		}
		return false;
	},
	/**
	 *
	 * @param origin
	 */
	getChildPath: function ( origin, forceNoTheoric, idOnly ) {
		// origin                    = origin ;
		// we want paths
		var map                   = this._objById,
		    including             = isArray(forceNoTheoric) && forceNoTheoric.length ? forceNoTheoric : false,
		    edge                  = map[origin || "_root"],
		    from                  = origin && edge._etty.getRef('originNode') || "start",
		    to                    = origin && edge._etty.getRef('targetNode') || "target",
		    cnode = from, i, path = [from], found, sid, nid, subPath, cEdge;
		// debugger;
		// forceNoTheoric            = including;
		
		// origin = origin || "_root";
		do {
			found = false;
			for ( i = 0; i < map[cnode]._outgoing.length; i++ ) {
				sid   = map[cnode]._outgoing[i];
				nid   = map[sid]._etty._.targetNode;
				cEdge = map[sid]._etty._;
				
				if ( sid == origin && map[cnode]._outgoing.length > 1 ) continue;
				
				if ( (!cEdge.PathIgnore || (cEdge.PathIgnore && cEdge.KeepInPath)) && cEdge._origin == origin ) {
					if ( path.indexOf(nid) != -1 ) debug.error("This graph have loops", path, nid);
					
					if ( cEdge.Theoric && forceNoTheoric && (!including || including.includes(cEdge._id)) ) {// so get the complete child path
						subPath = this.getChildPath(sid, true, true);
						if ( subPath.length ) {
							subPath.shift();
							path.push(...subPath);
						}
						else
							path.push(sid, nid);
					}
					else
						path.push(sid, nid);
					
					cnode = nid;
					found = true;
					break;
				}
				else {
					continue;
				}
				
				if ( cnode === to )
					break;
			}
			
			if ( !found ) {// take first
				// debug.log("notheoric here", map[sid]);
				sid = map[cnode]._outgoing[0];
				
				if ( sid == origin ) sid = map[cnode]._outgoing[1];
				
				if ( !sid ) {
					// debug.error("No child path", origin);
					return [];
				}
				
				path.push(sid, map[sid]._etty._.targetNode);
				cnode = map[sid]._etty._.targetNode;
				found = true;
			}
			
			if ( cnode === to )
				break;
		} while ( 1 );
		// debugger;
		// if ( origin == "_root" )
		
		
		return idOnly && path || path.map(( id ) => map[id]);
	},
	
	/**
	 * Get a all paths between fromId&toId & return them in json
	 * @param fromId
	 * @param toId
	 * @param ignoreMissing
	 * @returns {{maps: {}, paths: Array}}
	 */
	getPaths: function ( fromId, toId, skip ) {
		var map      = this._objById,
		    cmaps    = {},
		    start    = this._objById[fromId],
		    end      = this._objById[toId],
		    paths    = [],
		    stack    = [],
		    skipping = skip || [],
		    related,
		    haveNoTheoric,
		    cpath    = [fromId],
		    cnode, i, newPath, sid, nid;
		
		if ( !map[fromId] )
			debug.error(this._id, "GetPath from node can't be found in the graph", fromId);
		if ( !map[toId] )
			debug.error(this._id, "GetPath from node can't be found in the graph", toId);
		if ( !map[toId] || !map[fromId] )
			return {
				maps : cmaps,
				paths: paths
			};
		cmaps[fromId] = { ...map[fromId]._etty._ };
		
		do {
			cnode         = cpath[cpath.length - 1];//last is node
			haveNoTheoric = map[cnode]._outgoing.reduce(
				( p, c ) => {
					return p || !map[c]._etty._.Theoric
				}, false);// knowing if there only theoric ways
			
			for ( i = 0; i < map[cnode]._outgoing.length; i++ ) {
				newPath = cpath.slice();
				sid     = map[cnode]._outgoing[i];
				nid     = map[sid]._etty._.targetNode;// node
				
				// ignore theoric if possible
				if ( haveNoTheoric && map[sid]._etty._.Theoric )
					continue;
				
				// ignore theoric if possible
				if ( skipping.includes(sid) )
					continue;
				
				if ( (related = map[sid]._etty._.pathDescriptor) && map[related] ) {
					do {
						cmaps[related] = { ...map[related]._etty._ };
					} while ( related = map[related] && map[related]._etty._.parentPathDescriptor );// assume broken
				                                                                                    // refs are good in
				                                                                                    // other graphs
				}
				
				if ( (related = map[sid]._etty._._origin) && map[related] ) {// add _origin ( the theoric which has generated this segment )
					
					do {
						// if (map[related] && map[related]._etty._.thisOne)
						// debugger;
						
						if ( skipping.includes(related) )
							break;
						
						cmaps[related] = { ...map[related]._etty._ };
						related        = map[related] && map[related]._etty._._origin
						
					} while ( related && map[related] && !cmaps[related] );
				}
				
				newPath.push(sid, nid);
				
				if ( !cmaps[sid] )
					cmaps[sid] = { ...map[sid]._etty._ };
				// if ( !cmaps[nid] && !map[nid]){
				//     debug.error(
				//         nid,
				//         map[sid]._etty._
				//     )
				// }
				if ( !cmaps[nid] )
					cmaps[nid] = { ...map[nid]._etty._ };
				
				if ( nid === toId )
					paths.push(newPath);
				else
					stack.push(newPath);
			}
			
			if ( !stack.length ) break;
			cpath = stack.shift();
		} while ( 1 );
		
		return {
			maps : cmaps,
			paths: paths
		};
	},
	
	/**
	 * We need to know if a vendor record is mounted from some point,
	 * or we'll not have any method to know if a vendorRecord is still available
	 *
	 * @param to
	 * @param manager  // should contain getFormByRecordId, checkRecordValidityById, ...
	 */
	registerVendorRecordByKey: function ( to, manager ) {
	},
	/**
	 * Get an object by his id
	 * @param id
	 * @returns {*}
	 */
	getObjById: function ( id ) {
		return this._objById[id];
	},
	
	/**
	 * Get the concept map by his id
	 * @param id
	 * @returns {*}
	 */
	getEtty: function ( id ) {
		return this._objById[id] && this._objById[id]._etty;
	},
	/**
	 * Select all node that match the query
	 * @param _with Array
	 * @param _without Array
	 * @returns {array|*|Array}
	 */
	queryMaps: function ( query ) {
		
		var me   = this,
		    maps = this._objById,
		    fn   = isFunction(query) ? query : new Function("scope",
		                                                    "try{" +
			                                                    "return (" +
			                                                    (
				                                                    (
					                                                    isArray(query)
					                                                    ? query.length && query.join(") && (")
					                                                    : query
				                                                    ).replace(/\$(\$?[a-zA-Z\_][\w\.\:\$]+)/ig, "scope.getRef(\"$1\")")
				                                                    || "true"
			                                                    )
			                                                    + ");" +
			                                                    "}catch(e){" +
			                                                    "return undefined;" +
			                                                    "}"
		    )
		
		
		;
		// debugger;
		return Object.keys(maps).map(( k ) => maps[k]._etty).filter(fn);
		
	},
	/**
	 * Select all node with _with prop but whithout _whithout props
	 * @param _with Array
	 * @param _without Array
	 * @returns {array|*|Array}
	 */
	selectMaps: function ( _with, _without ) {
		var me = this;
		return this.selectMapsId(_with, _without).map(( v ) => me._objById[v] && me._objById[v]._etty);
		
	},
	
	/**
	 * Select all node id with _with prop but whithout _whithout props
	 * @param _with Array
	 * @param _without Array
	 * @returns {array|*|Array}
	 */
	selectMapsId: function ( _with, _without ) {
		var i = 0, me = this, maps = this._mapsByConcept,
		    _with                  = isArray(_with) ? _with : [_with],
		    _have,
		    _without               = isArray(_without) ? _without : [_without];
		
		
		_with.map(( v ) => maps[v] && (_have = intersect(_have || maps[v], maps[v])));
		_have && _without.map(( v ) => maps[v] && (_have = arrayDiffer(_have, maps[v])));
		
		
		return _have || [];
		
	},
	
	// -------------------------------------------------------------------------- events
	
	on: function ( evt, cb ) {
		if ( !isFunction(cb) ) throw 'wtf';
		
		this._on[evt] = this._on[evt] || [];
		this._on[evt].push(cb);
		
	},
	un: function ( evt, cb ) {
		//this._on[evt] = this._on[evt]||[];
		if ( !this._on[evt] ) return;
		var i = this._on[evt].indexOf(cb);
		this._on[evt].splice(i, 1);
	},
	/**
	 * Called once stabilized
	 * @private
	 */
	_applyStabilized: function () {
		debug.warn('graph seems stable !');
		var me           = this;
		this._stabilized = true;
		me._running      = false;
		// me._rev++;// graph inst revision
		this._on.stabilize
		&& this._on.stabilize.slice(0).map(( cb ) => cb(me, me._syncTokensList));
		this.cfg.onStabilize
		&& this.cfg.onStabilize(this, me._syncTokensList);
		me._syncTokensList = [];
	},
	history_push    : function ( mutation, targetId, isStep ) {
	},
	history_goto    : function ( to ) {
	},
	/**
	 * clean & unref
	 */
	destroy: function () {
		this._taskFlow.kill();
		var me = this;
		this._on.destroy
		&& this._on.destroy.slice(0).map(( cb ) => cb(me));
		Object.keys(this._objById).map(
			( k ) => me._objById[k].destroy ? me._objById[k].destroy() : me._objById[k]._etty.destroy());
		this._freeNodes = this._nodes = this._objById = me._conceptLib = me._syncTokens =
			me._syncTokensList = this._segments =
				this._rootConcept = this._mapsByConcept = this._on =
					this._history = this._unstable = this._pending = this._stable = this._objById = this._pendingMutationsById = null;
		this._dead      = true;
	}
};

module.exports = Graph;