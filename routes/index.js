var mongo = require('mongodb');

var Server = mongo.Server,
    Db = mongo.Db,
    BSON = mongo.BSON;

var server = new Server('localhost', 27017, {
    auto_reconnect: true
});

db = new Db('geo', server);

db.open(function (err, db) {
    if (!err) {
        console.log("Connected to 'geo' database");
    }
});

//TODO: error handling
app.get('/geocoder/findByAddress', function (req, res) {
    var streetAddr = req.query.addr.replace("  ", " ");
    var zip = req.query.zip;
    var parts = streetAddr.split(" ");
    var street = normalizeStreet(parts.slice(1).join(" "));

    var num = parseInt(parts[0]);
    var feature = {};
    db.collection('features', function (err, collection) {
        collection.find(buildQueryObj(num, street, zip)).toArray(function (err, items) {

            feature = searchFeatures(items, num, zip);
            var loc = {};
            if (feature.geometry !== undefined) {
                loc = computeLocation(num, feature.geometry.coordinates, feature.properties.LFROMADD, feature.properties.LTOADD, feature.properties.RFROMADD, feature.properties.RTOADD);
            } else {
                console.log("did not find loc for " + num + " " + street + " " + zip);
            }
            res.header("Content-Type", "application/json");
            res.send(loc);
        });

    });
});


/**
 * searches for the feature to use within the list passed in. It will first attempt to find the record with the same zip code. If not possible, it will
 * return the first match where num falls within the address range.
 *
 * @param items
 * @param num
 * @param zip
 * @returns {*}
 */
function searchFeatures(items, num, zip) {
    for (var i = 0; i < items.length; i++) {
        var temp = findFeature(num, zip, items[i], true);
        if (temp !== null) {
            return temp;
        }
    }
    for (var i = 0; i < items.length; i++) {
        var temp = findFeature(num, zip, items[i], false);
        if (temp !== null) {
            return temp;
        }
    }
    return {};
}

/**
 * finds which feature within the list that match the query should be used based on where the address falls in the ranges
 * @param num
 * @param zip
 * @param item
 * @param useZip
 * @returns {*}
 */
function findFeature(num, zip, item, useZip) {
    if (((item.properties.RFROMADD % 2 === 0 && num % 2 === 0) || (item.properties.RFROMADD % 2 !== 0 && num % 2 !== 0)) && (!useZip || item.properties.ZIPR == zip)) {
        //if the address is odd and the right side is odd
        if (num >= item.properties.RFROMADD && num <= item.properties.RTOADD) {
            return item;

        } else if (num <= item.properties.RFROMADD && num >= item.properties.RTOADD) {
            return item;
        }
    } else if (!useZip || item.properties.ZIPL == zip) {
        if (num >= item.properties.LFROMADD && num <= item.properties.LTOADD) {
            return item;
        } else if (num <= item.properties.LFROMADD && num >= item.properties.LTOADD) {
            return item;
        }
    }
    return null;
}

/**
 * interpolates a lat/lon location based on an address number and a TIGER GIS descriptor
 * @param num
 * @param coordinates
 * @param lFromAdd
 * @param lToAdd
 * @param rFromAdd
 * @param rToAdd
 * @returns {{}}
 */
function computeLocation(num, coordinates, lFromAdd, lToAdd, rFromAdd, rToAdd) {
    var loc = {};
    var coordCount = coordinates.length;
    if (num == lFromAdd || num == rFromAdd) {
        loc.lon = coordinates[0][0];
        loc.lat = coordinates[0][1];
    } else if (num == lToAdd || num == rToAdd) {
        loc.lon = coordinates[coordCount - 1][0];
        loc.lat = coordinates[coordCount - 1][1];
    } else {

        var totalDist = 0;
        var segmentDist = [];
        for (var i = 0; i < coordCount - 1; i++) {
            segmentDist.push(computeDistance(coordinates[i], coordinates[i + 1]));
            totalDist += segmentDist[i];
        }
        var addrPct = 0;
        if (num % 2 === 0) {
            if (lFromAdd % 2 === 0) {
                loc.side = 'L';
                addrPct = (num - lFromAdd) / (lToAdd - lFromAdd);
            } else {
                loc.side = 'R';
                addrPct = (num - rFromAdd) / (rToAdd - rFromAdd);
            }
        } else {
            if (lFromAdd % 2 !== 0) {
                loc.side = 'L';
                addrPct = (num - lFromAdd) / (lToAdd - lFromAdd);
            } else {
                loc.side = 'R';
                addrPct = (num - rFromAdd) / (rToAdd - rFromAdd);
            }

        }

        var targetDist = totalDist * addrPct;
        var accumulator = 0;

        var curSeg = 0;
        for (var j = 0; j < segmentDist.length; j++) {
            if (accumulator + segmentDist[j] < targetDist) {
                accumulator += segmentDist[j];
                curSeg = j;
            } else {
                break;
            }
        }

        if (accumulator == targetDist) {
            loc.lon = coordinates[curSeg][0];
            loc.lat = coordinates[curSeg][1];
        } else {
            var segPct = (targetDist - accumulator) / segmentDist[j];
            loc.lon = coordinates[curSeg][0] + ((coordinates[curSeg][0] - coordinates[curSeg + 1][0]) * segPct);
            loc.lat = coordinates[curSeg][1] + (coordinates[curSeg + 1][1] - coordinates[curSeg][1]) * ((loc.lon - coordinates[curSeg][0]) / (coordinates[curSeg + 1][0] - coordinates[curSeg][0]));
        }

    }
    return loc;
}

/**
 * builds a mongo query object based on the address params passed in
 * @param num
 * @param street
 * @param zip
 * @returns {{properties.ROADFLG: string, properties.FULLNAME: *, $or: *[], $or: *[]}}
 */
function buildQueryObj(num, street, zip) {

    var queryObj = {
        "properties.ROADFLG": "Y",
        "nameupper": new RegExp(street.toUpperCase()),
        $or: [
            {
                "properties.ZIPL": zip
            },
            {
                "properties.ZIPR": zip
            }
        ],
        $or: [
            {
                "properties.RFROMADD": {
                    $lte: num
                },
                "properties.RTOADD": {
                    $gte: num
                }
            },
            {
                "properties.RFROMADD": {
                    $gte: num
                },
                "properties.RTOADD": {
                    $lte: num
                }
            },
            {
                "properties.LFROMADD": {
                    $lte: num
                },
                "properties.LTOADD": {
                    $gte: num
                }
            },
            {
                "properties.LFROMADD": {
                    $gte: num
                },
                "properties.LTOADD": {
                    $lte: num
                }
            }
        ]
    };
    return queryObj;
}

/**
 * changes street, ave, etc to their expected format
 * @param s
 */
function normalizeStreet(s) {
    s = s.toUpperCase();
    s = s.replace("NORTH ", "N ");
    s = s.replace("SOUTH ", "S ");
    s = s.replace("EAST ", "E ");
    s = s.replace("WEST ", "W ");
    s = s.replace((/\bSTREET\b/, "ST");
    s = s.replace((/\bAVENUE\b/, "AVE");
    s = s.replace((/\bBOULEVARD\b/, "BLVD");
    s = s.replace((/\bCOURT\b/, "CT");
    s = s.replace((/\bCIRCLE\b/, "CIR");
    s = s.replace((/\bPARKWAY\b/, "PKWY");
    s = s.replace((/\bROAD\b/, "RD");
    s = s.replace(/\bDRIVE\b/, "DR");
    s = s.replace(/\bHIGHWAY\b/, "HWY");
    s = s.replace(/\bPLACE\b/,"PL");
    s = s.replace((/\bLANE\b/, "LN");
    s = s.replace("FIRST ", "1ST ");
    s = s.replace("SECOND ", "2ND ");
    s = s.replace("THIRD ", "3RD ");
    s = s.replace("FOURTH ", "4TH ");
    s = s.replace("FIFTH ", "5TH ");
    s = s.replace("SIXTH ", "6TH ");
    s = s.replace("SEVENTH ", "7TH ");
    s = s.replace("EIGHTH ", "8TH ");
    s = s.replace("NINTH ", "9TH ");
    s = s.replace("TENTH ", "10TH ");

    s = s.replace("TLP#", "");
    s = s.replace(/UNIT(\s\S+)?/, "");
    s = s.replace(/SUITE(\s\S+)?/, "");
    s = s.replace("(", "");
    s = s.replace(")", "");
    s = s.replace("#", "");
    s = s.replace("@", "");
    s = s.replace("-", "");

    //strip off any unit number at the end of the string
    var matches = s.match(/\d+$/);
    if (matches) {
        s = s.replace(matches[0], "");
    }
    s = s.replace(/\bAT\s/,"");
    return s.trim();
}

/**
 * computes the linear distance between two points
 * @param p1
 * @param p2
 * @returns {number}
 */
function computeDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2));
}
