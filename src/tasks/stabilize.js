/**
 * @author Nathanael BRAUN
 *
 * Date: 18/01/2016
 * Time: 14:51
 */

var debug = console;
/*
 * Launch concepts stabilisation on every unstable nodes
 */
module.exports = function ( graph, flow ) {
	
	debug.info("%s : Launch stabilisation on %s unstable obj, %s triggers", graph.cfg.label, graph._unstable.length,
	           graph._triggeredCastCount);
	//debugger;
	//
	if ( graph._triggeredCastCount ) {
		var updates = Object.keys(graph._triggeredCast);
		flow.pushSubTask(
			updates.map(
				( k ) => {
					debug.log("updates %s !! ", k);
					
					graph.toggleGraphObjectState(graph._triggeredCast[k][0], "unstable");
					return graph._conceptLib[graph._triggeredCast[k][1]].applyTo(
						graph._objById[graph._triggeredCast[k][0]]._etty,
						graph
					);
				}
			)
		)
		
		graph._triggeredCast      = {};
		graph._triggeredCastCount = 0;
		// if ( me._unstable.length )
		//     flow.then(me._loopTF);
	}
	
	flow.pushSubTask(
		graph._unstable.map(
			function ( v ) {
				return v.specialize && v.specialize() || v._etty.specialize();
			}
		));
};