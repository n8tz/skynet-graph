/**
 * @author Nathanael BRAUN
 *
 * Date: 14/01/2016
 * Time: 13:24
 */

var Entity = require('./Entity');
var debug  = console;

function Segment( _, graph, parentMutation ) {
	this.init(_, graph, parentMutation);
};
Segment.prototype = {
	init           : function ( _, graph, parentMutation ) {
		this._id                        = _._id;
		this._graph                     = graph;
		this._etty                      = new Entity(
			{
				_id    : _._id,
				Segment: true
			},
			graph
		);
		graph._mapsByConcept["Segment"] = graph._mapsByConcept["Segment"] || [];
		graph._mapsByConcept["Segment"].push(_._id);
		this._etty.follow("targetNode", this._onTargetChange, this);
		this._etty.follow("originNode", this._onOriginChange, this);
		this._etty.follow("_autokill", this._killMe, this);
		this._ppp = _;
		this._etty.update(_, graph);
		
		// this._etty.updateApplicableConcepts();
		// this._onTargetChange()
	},
	_killMe        : function ( n, o ) {
		this._etty.unRefAll();
		debug.warn("Unref ", this._id, "here");
		this._etty.set("targetNode", null);
		this._etty.set("originNode", null);
		// this._graph.removeObj(this._id);
	},
	/**
	 * update targeted nodes; updating the graph
	 * @param o
	 * @param n
	 * @private
	 */
	_onTargetChange: function ( n, o ) {
		var node = o && this._graph.getObjById(o), i;
		if ( node ) {
			i = node._incoming.indexOf(this._id);
			if ( i != -1 )
				node._incoming.splice(i, 1);
		}
		node = n && this._graph.getObjById(n);
		node && node._incoming.push(this._id);
		if ( !node && n ) {
			// debugger;
			debug.error("Cant relink target from ", o, 'to', n, this._ppp);
		}
		//node && debug.log("relink target from ", o, 'to', n);
		
	},
	/**
	 * update origin nodes; updating the graph
	 * @param o
	 * @param n
	 * @private
	 */
	_onOriginChange: function ( n, o ) {
		var node = o && this._graph.getObjById(o), i;
		if ( node ) {
			i = node._outgoing.indexOf(this._id);
			if ( i != -1 )
				node._outgoing.splice(i, 1);
		}
		node = n && this._graph.getObjById(n);
		node && node._outgoing.push(this._id);
		if ( !node && n ) {
			// debugger;
			debug.error("Cant relink origin from ", o, 'to', n);
		}
		//node && debug.log("relink origin from ", o, 'to', n);
	},
	relink         : function () {
		this._etty.unRefAll();
	},
	specialize     : function () {
		return this._etty.specialize();
	}
};
module.exports    = Segment;