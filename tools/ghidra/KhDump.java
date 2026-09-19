// Ghidra headless post-script: dump text-related strings, their xrefs and decompiled callers.
// Output dir: env KH_OUT (defaults next to the project).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.*;
import ghidra.program.model.symbol.*;
import ghidra.util.task.TaskMonitor;
import java.io.*;
import java.util.*;

public class KhDump extends GhidraScript {
  @Override
  public void run() throws Exception {
    String outDir = System.getenv("KH_OUT");
    if (outDir == null) outDir = "E:/ghidra_out";
    new File(outDir).mkdirs();
    Program p = currentProgram;
    Listing listing = p.getListing();
    FunctionManager fm = p.getFunctionManager();
    ReferenceManager rm = p.getReferenceManager();

    // 1) all defined strings
    PrintWriter sw = new PrintWriter(new OutputStreamWriter(new FileOutputStream(new File(outDir, "strings.txt")), "UTF-8"));
    List<Data> interesting = new ArrayList<>();
    String[] keys = { "Message v", "EvMsg", "sysmsg", ".binl", ".evdl", "KGR", "CTD", "mes_ofs", "mes_data",
                      "btltbl", "AbilityName", "ItemHelp", "kmb", ".ard", "remastered", "FontEn", ".hed", ".pkg",
                      "menu/", "event/", "msg", "Msg", "font", "Font", "wsysmsg", "Word.bin", "ShopMessage", "%s.bin" };
    for (Data d : listing.getDefinedData(true)) {
      if (!d.hasStringValue()) continue;
      Object v = d.getValue();
      if (v == null) continue;
      String s = v.toString();
      sw.println(d.getAddress() + "\t" + s.replace("\n", "\\n").replace("\r", "\\r"));
      for (String k : keys) { if (s.contains(k)) { interesting.add(d); break; } }
    }
    sw.close();

    // 2) interesting strings + xrefs + caller functions
    PrintWriter iw = new PrintWriter(new OutputStreamWriter(new FileOutputStream(new File(outDir, "interesting.txt")), "UTF-8"));
    Set<Function> toDecompile = new LinkedHashSet<>();
    for (Data d : interesting) {
      String s = d.getValue().toString().replace("\n", "\\n");
      iw.println("== " + d.getAddress() + "  \"" + s + "\"");
      for (Reference r : rm.getReferencesTo(d.getAddress())) {
        Function f = fm.getFunctionContaining(r.getFromAddress());
        iw.println("   xref " + r.getFromAddress() + " in " + (f == null ? "?" : f.getName() + " @ " + f.getEntryPoint()));
        if (f != null) toDecompile.add(f);
      }
    }
    iw.close();

    // 3) function summary
    PrintWriter fw = new PrintWriter(new File(outDir, "functions.txt"));
    int n = 0;
    for (Function f : fm.getFunctions(true)) { fw.println(f.getEntryPoint() + "\t" + f.getName() + "\t" + f.getBody().getNumAddresses()); n++; }
    fw.close();
    println("functions: " + n + ", interesting strings: " + interesting.size() + ", callers: " + toDecompile.size());

    // 4) decompile callers (+ their callers one level up) — capped
    DecompInterface di = new DecompInterface();
    di.openProgram(p);
    Set<Function> level2 = new LinkedHashSet<>();
    for (Function f : toDecompile) for (Function c : f.getCallingFunctions(TaskMonitor.DUMMY)) level2.add(c);
    List<Function> all = new ArrayList<>(toDecompile);
    for (Function f : level2) if (!toDecompile.contains(f)) all.add(f);
    int cap = Math.min(all.size(), 400);
    File dd = new File(outDir, "decomp"); dd.mkdirs();
    PrintWriter idx = new PrintWriter(new File(outDir, "decomp_index.txt"));
    for (int i = 0; i < cap; i++) {
      Function f = all.get(i);
      DecompileResults res = di.decompileFunction(f, 60, TaskMonitor.DUMMY);
      String code = (res != null && res.getDecompiledFunction() != null) ? res.getDecompiledFunction().getC() : "// decompile failed";
      String name = f.getEntryPoint() + "_" + f.getName().replaceAll("[^A-Za-z0-9_]", "_");
      try (PrintWriter w = new PrintWriter(new OutputStreamWriter(new FileOutputStream(new File(dd, name + ".c")), "UTF-8"))) { w.print(code); }
      idx.println(name + "\t" + (toDecompile.contains(f) ? "direct" : "caller"));
    }
    idx.close();
    di.dispose();
    println("decompiled " + cap + " functions to " + dd);
  }
}
