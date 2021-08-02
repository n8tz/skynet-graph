/*
 * Copyright (c) 2017.  Caipi Labs.  All rights reserved.
 *
 * This File is part of Caipi. You can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 *  This project is dual licensed under AGPL and Commercial Licence.
 *
 * @author : Nathanael Braun
 * @contact : caipilabs@gmail.com
 */

var child_process = require('child_process');
var os            = require('os');
var shortid       = require('shortid');
var path          = require('path'),
    packageCfg    = JSON.parse(require('fs').readFileSync(__dirname + '/../package.json'));
var TUtils  = require('../TimingUtils')


var util  = require('util'),
    spawn = require('child_process').spawn,
    cmd;

/**
 * This function print a path in a human formatted way
 * @param path  the path to print
 * @param allPath the PathMap object
 */
var printpath = function( path , allPath , serialize ) {
    var pathStr = "";;
    
    //console.log("dans print path " + JSON.stringify(path,null,4) );
    
    path.tpl.map(
        ( step )=> {
            var thisone = "";
            
            if ( step.ShortTravel ) {
                thisone = "---{Short}--->";
            }
            else if ( step.LongTravel ) {
                thisone = "----{Long}---->";;
            }
            else if ( step.PlaneTravel ) {
                thisone = "----{Plane}---->";;
            }
            else if ( step.Stay ) {
                thisone = "****"
            }
            else if ( step.OpenDest ) {
                thisone = "#OpenDest#"
            }
            else if ( step.CommonPlaceName ) {
                thisone = "[Place:" + step.CommonPlaceName + "]";
            }
            else {
                thisone = "#UNKNOWN#";
            }
            
            if( step.TimePeriod ) {
                thisone += "{" + TUtils.formatPeriodLength(TUtils.getLengthFromPeriod(step.TimePeriod)) + "}";
            }
            
            pathStr += thisone;
            if ( serialize ) {
                console.log( "Concept : " + thisone + " -> " + JSON.stringify(step,null,2)  );
            }
        });
    
    var pathDescriptor = allPath.getPathDescriptor(path);
    if ( pathDescriptor && pathDescriptor.length > 0 ) {
        
        // Calculate path (price)
        var price = CommonTravel.getPrice( path , allPath );
        
        var stopOverTime = TUtils.formatPeriodLength(CommonTravel.getStopOvertime( path , allPath ));
        var flightTime = TUtils.formatPeriodLength(CommonTravel.getTransportLength( path , allPath ));
        
        var quality = CommonTravel.getQuality( path , allPath );
        
        // CalCulate number of steps
        var nbrStop = CommonTravel.getNbrStop( path , allPath );
        
        var carbonFootprint = CommonTravel.getCarbonFootprint( path , allPath );
        
        pathStr = "[Descriptor: PRICE: " + price + " - STOPTIME: " + stopOverTime + " - FLIGHTTIME: |" + flightTime + "| - NBRSTOP: " + nbrStop + " - QUALITY: " + quality + " - Carbon: " + carbonFootprint +  "]\n" + pathStr;
    }
    console.log( "Path : " + pathStr + "\n\n");
};
//console.log = console.warn;

describe('Aetheris Graph', function () {
    let Graph,
        StaticContext,
        TestGraph;
    it('should build well', function ( done ) {
        this.timeout(Infinity);

        child_process.exec(
            'npm run build',
            {
                //cwd: "/"
            },
            function ( error, stdout, stderr ) {
                done(error)
            });

    });
    it('should require well', function ( done ) {
        this.timeout(Infinity);
        try {
            Graph = require('../dist/graph');
        }catch (e){
            console.log(e)
        }
        
        done(!Graph)
    });
    it('should load & stabilize here to singapore', function ( done ) {
        let initialTpl;
        try {
            initialTpl = JSON.parse(require('fs').readFileSync("./tests/test.json"));
        } catch (e) {
            console.error(e);
            process.exit();
        }
        TestGraph = new Graph(
            initialTpl,
            {
                label      : "TestGraph",
                autoMount  : true,// auto apply the concepts while the graph is unstable
                conceptSets: ["common", "QueryBased"],
                onStabilize: function ( graph, receivedTokens ) {
                    var paths    = graph.getPaths("start", "target"), // get pathMap
                        pathMngr = new Graph.PathMap(paths);
    
    
                    // First print all path to see what's on the result path
                    var allPath = pathMngr.selectPaths(["_id"], []);
                    //console.log(allPath._)
                    allPath._selected.map(
                        ( pathId, index ) => {
            
                            var path = pathMngr.getPath(pathId);
                            //console.log(pathId, path.length)
                            printpath( path , allPath );
            
                        });
                    graph.printStats()
                    done()
                }
            }
        );
        
        //console.log(Graph)
    });
    
});
