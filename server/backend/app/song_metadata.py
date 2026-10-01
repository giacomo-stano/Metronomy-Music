"""Public song metadata, including every ISRC supplied by the music server.

OpenSubsonic's Child.isrc is an array, not necessarily a single recording code.
Keep all valid candidates for Music Haptics without finding substitute recordings
by title/artist or inventing identifiers that do not belong to the user's file.
"""
import re


_ISRC = re.compile(r"[A-Z]{2}[A-Z0-9]{3}[0-9]{7}", re.ASCII)


def normalize_isrc(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    # Accept customary display formatting, but never extract a substring from
    # another identifier, a URL, a comment, or two codes concatenated together.
    code = re.sub(r"[\s-]", "", value)
    if not code.isascii():
        return None
    code = code.upper()
    return code if _ISRC.fullmatch(code) else None


def isrc_candidates(item: dict) -> list[str]:
    result = []
    # isrc is the OpenSubsonic field; case variants occur in imported tags.
    # isrcs is our normalized bridge field, retained when mapping cached data.
    for key, value in item.items():
        if not isinstance(key, str) or key.casefold() not in ("isrc", "isrcs"):
            continue
        for candidate in value if isinstance(value, list) else [value]:
            code = normalize_isrc(candidate)
            if code and code not in result:
                result.append(code)
    return result


def song(item: dict) -> dict:
    candidates = isrc_candidates(item)
    return {
        "id": item["id"], "title": item.get("title", "Untitled"),
        "artist": item.get("artist", "Unknown artist"), "album": item.get("album"),
        "duration": item.get("duration", 0), "coverArt": item.get("coverArt"),
        "track": item.get("track"), "year": item.get("year"),
        "albumId": item.get("albumId"), "artistId": item.get("artistId"),
        "starred": bool(item.get("starred")),
        # Keep the scalar for existing clients; newer ones try all candidates.
        "isrc": candidates[0] if candidates else None, "isrcs": candidates,
    }


def song_info(item: dict) -> dict:
    info = {key: item.get(key) for key in (
        "genre", "year", "bitRate", "samplingRate", "bitDepth", "suffix",
        "isrc", "artists", "albumArtists",
    )}
    # Preserve the existing raw isrc field for backwards compatibility.
    info["isrcs"] = isrc_candidates(item)
    return info
