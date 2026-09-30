from fastapi import APIRouter

from app.api.v1.routes.auth import router as auth_router
from app.api.v1.routes.ai import (
    meetings_router as ai_meetings_router,
    summaries_router,
    translations_router,
)
from app.api.v1.routes.capabilities import router as capabilities_router
from app.api.v1.routes.collaboration import comments_router, meetings_router as collaboration_meetings_router, shares_router
from app.api.v1.routes.exports import exports_router, meetings_router as export_meetings_router
from app.api.v1.routes.health import router as health_router
from app.api.v1.routes.meetings import router as meetings_router
from app.api.v1.routes.media import jobs_router, meetings_router as media_router
from app.api.v1.routes.realtime import router as realtime_router
from app.api.v1.routes.transcripts import (
    meetings_router as transcript_meetings_router,
    segments_router,
    speakers_router,
)

api_router = APIRouter()
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(capabilities_router, tags=["providers"])
api_router.include_router(health_router, tags=["system"])
api_router.include_router(meetings_router, tags=["meetings"])
api_router.include_router(media_router, tags=["media"])
api_router.include_router(export_meetings_router, tags=["exports"])
api_router.include_router(exports_router, tags=["exports"])
api_router.include_router(collaboration_meetings_router, tags=["comments"])
api_router.include_router(comments_router, tags=["comments"])
api_router.include_router(shares_router, tags=["shares"])
api_router.include_router(jobs_router, tags=["jobs"])
api_router.include_router(realtime_router, tags=["realtime"])
api_router.include_router(transcript_meetings_router, tags=["transcripts"])
api_router.include_router(segments_router, tags=["transcripts"])
api_router.include_router(speakers_router, tags=["speakers"])
api_router.include_router(ai_meetings_router, tags=["ai"])
api_router.include_router(translations_router, tags=["translations"])
api_router.include_router(summaries_router, tags=["summaries"])
