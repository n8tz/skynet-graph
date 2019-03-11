/**
 * @author Nathanael BRAUN
 *
 * Date: 14/01/2016
 * Time: 13:23
 */
var debug = console;

var isArray    = require('is').array;
var isFunction = require('is').fn;


let evalReplaceRE = /\$(\$?[a-zA-Z\_][\w\.\:\$]+)/ig;// 30mn;


function static_ensure( scope, c, cName ) {
	return function () {
		var __R;
		__R = scope._graph._conceptLib[c].isApplicableTo(scope);
		// debug.warn('test', c, __R, scope._mappedConcepts[cName]);
		// "\nif (c=='Edge:Stay:WNWizard:GoSomewhere:SelectingTarget')debugger;\n" +
		if ( __R ) !scope._mappedConcepts[cName] && scope._graph.castConcept(scope._._id, c);
		else scope._mappedConcepts[cName] && scope.unCast(cName, null);
	}
}

function Entity( _, graph ) {
	this.init(_, graph);
}

Entity.prototype = {
	/**
	 *
	 * @param _
	 * @param graph
	 */
	init: function ( _, graph ) {
		this._                = _;
		// if (!graph) debugger;
		this._graph           = graph;
		this._mapOpenConcepts = Object.keys(graph._rootConcept._openConcepts);
		this._mappedConcepts  = {};
		this._extOpenConcepts = [];
		
		this._followersByConceptName = {};
		this._watcherByConceptName   = {};
		this._watchers               = {};
		
	},
	
	// ------------------------------------------------- concepts cast
	
	/**
	 * Update auto-applicable concepts,
	 * Add 'ensure' watchers (autocast/decast when condition are meet)
	 * @returns {Array}
	 */
	updateApplicableConcepts: function () {
		if ( this._dead ) return [];
		
		var me      = this,
		    execTm  = Date.now(),
		    push    = Array.prototype.push,
		    cStack  = [],
		    ocStack = this._mapOpenConcepts,
		    c, i, cname,
		    cSchema,
		    follow,
		    followMap, ensure,
		    graph   = this._graph;
		
		// if (!me._._id)
		//     console.log(me._);
		
		if ( me._._id.match(/debug/) ) debugger;
		// if (this._.AirLine_IATA) debugger;
		
		// if ( this._._id == "step2" ) debugger;
		
		while ( ocStack.length ) {
			c       = ocStack.pop();
			cname   = graph._conceptLib[c]._name;
			cSchema = graph._conceptLib[c]._schema;
			
			// if an "open" concept have follow || ensure it must watch some refs
			if ( !me._watchers[cname] && (cSchema.follow || cSchema.ensure) ) {
				followMap = {};
				follow    = [];
				follow.map(( v ) => followMap[v] = true);
				ensure = null;
				
				me._watchers[cname] = [];
				if ( cSchema.ensure ) {//@todo : optims
					ensure = static_ensure(me, c, cname);
					
					cSchema.ensure.forEach(
						( exp ) => {
							var e = exp.match(/\$(\$?[a-zA-Z\_][\w\.\:\$]+)/ig);
							// e && e.shift();
							e && e.length
							&& e.forEach(( v ) => {
								followMap[v.substr(1)] = ensure
							})
						}
					);
					follow = Object.keys(followMap);
					
					follow.forEach(function ( ref ) {
						var wfn = () => {
							// debug.info("follow ", ref);
							ensure(...arguments)
						};
						me._watchers[cname].push(ref, wfn);
						return !graph.getRef(ref, me, wfn) && true || null;
					});
				}
				cSchema.follow && cSchema.follow.reduce(function ( v, ref ) {//@todo : big optims
					var wfn = (
						(new Function("c", "graph", "me",
						              "return function b_" + cname.replace(/[^\w]/ig, '_') + "(){" +
							              "graph._conceptLib[c].isApplicableTo(me, graph)&&" +
							              "graph.castConcept(me._._id, c)};" +
							              ""))(c, graph, me)
					);
					me._watchers[cname].push(ref, wfn);
					return graph.getRef(ref, me, wfn) && v;
				}, true);
			}
			if ( me._[cname] || me._[cname] === false ) {
				this._mappedConcepts[cname] = graph._conceptLib[c];
				
				i = this._extOpenConcepts.indexOf(c);
				if ( i !== -1 ) {
					this._extOpenConcepts.splice(i, 1);
				}
				if ( graph._conceptLib[c]._schema.autoReCast ) {
					// debugger;
					graph.castConcept(this._._id, c);
				}
				if ( (!graph._conceptLib[c].isApplicableTo(me, graph) &&
					graph._conceptLib[c]._schema.autoCast !== false) || graph._conceptLib[c].isLeaf ) continue;
				if ( cSchema.type == "enum" ) {
					push.apply(
						ocStack,
						isArray(me._[cname]) ?
						me._[cname]
						                     :
						me._[cname] && Object.keys(graph._conceptLib[c]._openConcepts) || []
					);
				}
				else {
					// if not leaf check childs
					// debug.warn("add childs of:", c);
					
					push.apply(ocStack, Object.keys(graph._conceptLib[c]._openConcepts));
				}
			}
			else {
				if ( cSchema.autoCast === false ) {
					i = this._extOpenConcepts.indexOf(c);
					(i == -1) && this._extOpenConcepts.push(c);
				}
				cStack.push(c);
			}
		}
		this._mapOpenConcepts = cStack;
		
		
		let ret = cStack.filter(function ( c ) {// test if c is applicable
			return !!graph._conceptLib[c].isApplicableTo(me, graph);
		}).map(function ( c ) {
			return graph._conceptLib[c];
		});
		
		
		// stats
		graph._statsByProvider["updateApplicableConcepts"] = graph._statsByProvider["updateApplicableConcepts"] || 0;
		graph._statsByProvider["updateApplicableConcepts"] += (Date.now() - execTm);
		
		return ret;
	},
	/**
	 * Uncast a concept
	 * (remove watchers, re-add in applicable concepts if needed, chain uncast child concepts available in the currents
	 * concepts set)
	 * @note : this one and
	 *
	 * @param cid
	 * @param unReachable
	 */
	unCast                  : function ( cid, unReachable ) {
		
		var me = this, graph = me._graph;
		
		// if ( cid == 'SelectingTarget' )
		//     debugger;
		
		while ( this._watchers[cid] && this._watchers[cid].length )
			this._graph.getRef(this._watchers[cid].shift(), this, this._watchers[cid].shift(), true);
		
		if ( this._mappedConcepts[cid] ) {
			// debug.log("Uncast ", cid, 'on', this._id);
			
			delete this._[cid];
			var c = this._mappedConcepts[cid],
			    i = this._graph._mapsByConcept[c._name] && this._graph._mapsByConcept[c._name].indexOf(this._._id);
			this._graph._mapsByConcept[c._name] && (i != -1) && this._graph._mapsByConcept[c._name].splice(i, 1);
			if ( !c ) return debug.warn('cant uncast', cid);
			
			//i = .indexOf()
			this._mapOpenConcepts = this._mapOpenConcepts.filter(( v ) => (v.substr(0, c._id.length) != c._id));
			this._extOpenConcepts = this._extOpenConcepts.filter(( v ) => (v.substr(0, c._id.length) != c._id));
			
			if ( !unReachable ) {
				this._mapOpenConcepts.push(c._id);
			}
			
			c._openConcepts
			&& Object.keys(c._openConcepts)
			         .forEach(( v ) => (this.unCast(c._openConcepts[v]._name, c._openConcepts[v]._id)), this);
			
			// uncaster
			if ( c._schema.cleaner ) {
				var p         = isArray(c._schema.cleaner) ? c._schema.cleaner[0] : c._schema.cleaner,
				    argz      = isArray(c._schema.cleaner) && c._schema.cleaner.slice(1),
				    providers = graph.static._providers;
				p             = p.split("::");
				if ( providers[p[0]] && providers[p[0]][p[1]] ) {
					graph._taskFlow.wait();
					providers[p[0]][p[1]](
						graph, c, me, argz,
						function ( e, r ) {
							r && graph.pushMutation(r, me._._id);
							e && debug.log("Hum cleaner ", p, " has failed : \n", e, e.stack);
							graph._taskFlow.release();
						});
				}
			}
		}
		else {
			unReachable && (this._mapOpenConcepts = this._mapOpenConcepts.filter(
				( v ) => (v.substr(0, unReachable.length) != unReachable)));
		}
		this._watchers[cid] = this._mappedConcepts[cid] = undefined;
	},
	/**
	 * return an async specialisation task that will apply open-concepts
	 * (this will be called as long as the box is unstable)
	 */
	specialize              : function () {
		var me = this;
		return function doSpecialize( graph, flow ) {
			if ( me._dead ) return graph.removeObj(me._._id, true);
			
			var concepts = me.updateApplicableConcepts(graph),
			    todo     = [];
			
			if ( !concepts.length ) {// if there is no applicable concept; this scope is stable
				return graph.toggleGraphObjectState(me._._id, "stable");
			}
			// if mutations come the node will go in pending state
			//
			// debug.log("Start specialize on ", me._, " using base concept ", cConcept, "\napplicable : ", concepts);
			concepts.forEach(
				function ( c ) {
					todo.push(c.applyTo(me, graph))
				}
			);
			return todo;
		};
	},
	/**
	 * Merge '_' keys-values in the cbox, call watchers if needed
	 * @param _
	 * @param graph
	 */
	update                  : function ( _, graph ) {
		var me = this;
		
		if ( me._._id.match(/debug/) ) debugger;
		Object.keys(_).forEach(
			function ( c ) {
				me.set(c, _[c], graph);
			}
		)
	},
	/**
	 * set an element by concept name, trigger watchers
	 *
	 * @param key
	 */
	set                     : function ( key, content, graph ) {
		var old = this._[key], tmp;
		if ( this._dead ) return;
		
		this._[key]                     = content;
		this._graph._mapsByConcept[key] = this._graph._mapsByConcept[key] || [];
		(old === undefined) && this._graph._mapsByConcept[key].push(this._._id);
		
		if ( content === null && old !== null && this._mappedConcepts[key] ) {// unref concept
			this.unCast(key);
		}
		
		if ( this._watcherByConceptName[key] ) {
			var i = 0;
			tmp   = this._watcherByConceptName[key].slice();
			// if ( key == 'UI_SelectedPath' && !content ) debugger;
			// debug.log(
			//     "watcher on set ", this._._id, key
			// );
			while ( i < tmp.length ) {
				tmp[i].call(
					tmp[i + 1],
					content,
					old
				);
				if ( this._dead ) return;
				i += 2;
			}
		}
		if ( this._followersByConceptName[key] ) {
			var i = -1;
			while ( ++i < this._followersByConceptName[key].length ) {
				// debug.log(
				//     "destabilize ", this._followersByConceptName[key][i],
				//     "due to set ", this._._id, key
				// );
				this._graph.toggleGraphObjectState(this._followersByConceptName[key][i], "unstable");
			}
		}
	},
	/**
	 * get an element by concept name
	 * if followerId is set, followerId will be destabilized
	 *
	 * @param key
	 * @param followerId
	 */
	get                     : function ( key, followerId, doUnref ) {
		if ( typeof followerId == "function" ) {
			doUnref ?
			this.unFollow(key, followerId)
			        :
			this.follow(key, followerId);
		}
		else if ( followerId ) {
			if ( followerId === this._._id ) return this._[key];
			
			this._followersByConceptName[key] = this._followersByConceptName[key] || [];
			var i                             = this._followersByConceptName[key].indexOf(followerId);
			if ( i == -1 && !doUnref )
				this._followersByConceptName[key].push(followerId);
			if ( i !== -1 && doUnref )
				this._followersByConceptName[key].splice(i, 1);
			
		}
		return this._[key];
		
	},
	// -------------------------------------------------- refs & events
	doEval                  : function ( asserts = "", refMap ) {
		
		let expr   = isArray(asserts) &&
			asserts.join(") && (")
			       .replace(evalReplaceRE, "scope.getRef(\"$1\")")
			|| asserts.replace(evalReplaceRE, "scope.getRef(\"$1\")"),
		    testFn =
			    // TCache.get(expr)
			    // || TCache.set(
			    // expr,
			    new Function("scope", "graph", "refMap",
			                 "with(refMap){return (" + expr + ");}"
			    )
		// );
		// if (refMap) debugger;
		try {
			return testFn(this, this._graph, refMap || {});
		} catch ( e ) {
			debug.error("Eval fail : ", asserts, " using ", refMap, e);
			return undefined;
		}
	},
	
	/**
	 * evaluate 'exp' from this cbox, and add 'follow' as watcher if the targeted value is updated
	 *
	 * @param exp
	 * @param follow
	 * @param unref bool do unwatch 'follow' instead of watch
	 * @returns {*}
	 */
	getRef  : function ( exp, follow, unref ) {
		return this._graph.getRef(exp, this, follow, unref);
	},
	/**
	 * call 'fn' on any change to 'key'
	 * @param key
	 * @param fn
	 * @param scope
	 */
	follow  : function ( key, fn, scope ) {
		this._watcherByConceptName[key] = this._watcherByConceptName[key] || [];
		this._watcherByConceptName[key].push(fn, scope);
	},
	/**
	 * Stop calling 'fn' on 'key' change
	 * @param key
	 * @param fn
	 * @param scope
	 */
	unFollow: function ( key, fn, scope ) {
		
		this._watcherByConceptName[key] = this._watcherByConceptName[key] || [];
		var i                           = this._watcherByConceptName[key].indexOf(fn);//@todo
		(i != -1) && this._watcherByConceptName[key].splice(i, 2);
	},
	
	/**
	 * dirty reset/clean of the box
	 */
	reset   : function () {
		this._mapOpenConcepts        = Object.keys(this._graph._rootConcept._openConcepts);
		this._mappedConcepts         = {};
		this._followersByConceptName = {};
		this._watcherByConceptName   = {};
	},
	/**
	 * Do un ref watchers boris watchvosky
	 */
	unRefAll: function () {
		var me = this;
		Object.keys(this._watchers)
		      .forEach(( k ) => {
			      while ( me._watchers[k].length ) {
				      me._graph.getRef(me._watchers[k].shift(), me, me._watchers[k].shift(), true)
			      }
		      });
		
		this._watchers = {};
		Object.keys(this._)
		      .forEach(( k ) => {
			      var i = me._graph._mapsByConcept[k].indexOf(me._._id);
			      (i != -1) && me._graph._mapsByConcept[k].splice(i, 1);
			      me._graph._conceptLib[k] && me._graph._conceptLib[k].unRefRequires(me, me._graph);
		      });
	},
	
	test: function ( query ) {// only for ui !
		
		var me = this,
		    fn = isFunction(query) ? query :
		         new Function(
			         "scope",
			         "try{" +
				         "return (" +
				         (
					         (
						         isArray(query) ?
						         query.length && query.join(") && (")
						                        :
						         query
					         ).replace(/\$(\$?[a-zA-Z\_][\w\.\:\$]+)/ig, "scope.getRef(\"$1\")")
					         || "false"
				         )
				         + ");" +
				         "}catch(e){" +
				         "return undefined;" +
				         "}"
		         )
		
		
		;
		// debugger;
		return fn(this);
		
	},
	
	destroy: function ( unrefAll ) {
		var me                = this;
		this._dead            = true;
		this._mapOpenConcepts = this._mappedConcepts = this._followersByConceptName = this._watcherByConceptName = null;
		this._                = {};
	}
};

module.exports = Entity;