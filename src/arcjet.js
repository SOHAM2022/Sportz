import arcjet , {shield,detectBot,slidingWindow} from "@arcjet/node";
import "dotenv/config";

const ARCJETKEY = process.env.ARCJET_KEY;
const ARCJETMODE = process.env.ARCJETMODE === 'DRY_RUN' ? 'DRY_RUN' : 'LIVE'


if(!ARCJETKEY) throw new Error('ARCJETKEY is not set')

export const httpArcjet = ARCJETKEY ?
    arcjet({
        key: ARCJETKEY,
        rules:[
            shield({mode:ARCJETMODE}),
            detectBot({mode:ARCJETMODE,allow:["CATEGORY:SEARCH_ENGINE","CATEGORY:PREVIEW","CATEGORY:TOOL"]}),
            slidingWindow({mode:ARCJETMODE,interval:'10s',max:50})
        ]
    }) : null



export const wsArcjet = ARCJETKEY ?
    arcjet({
        key: ARCJETKEY,
        rules:[
            slidingWindow({mode:ARCJETMODE,interval:'10s',max:50})
        ]
    }) : null


export function securityMiddleware(){
    return async(req,res,next)=>{

        if(!httpArcjet) return next();

        try {
            const decision = await httpArcjet.protect(req);
            if(decision.isDenied()){
                if(decision.reason.isRateLimit()) return res.status(429).json({error:'rate limit exceeded'})

                return res.status(403).json({error:'forbidden'})
            }
        }catch (e) {
            console.error("arcjet middleware error ",e);
            return res.status(503).json({error:"arcjet middleware error"})
        }


        next();
    }
}