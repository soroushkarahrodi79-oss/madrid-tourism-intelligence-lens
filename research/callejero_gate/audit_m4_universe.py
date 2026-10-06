from audit_common import build_all, output_json

if __name__ == "__main__":
    output_json("m4_universe.json", build_all()["m4_universe.json"])
